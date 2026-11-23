import errno
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile

FIXTURE = """import { createAssistantMessageEventStream } from 'omk-ai';
const cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
export default (omk) => omk.registerProvider('standalone-fixture', {
  api: 'standalone-fixture', apiKey: 'fixture', baseUrl: 'http://127.0.0.1:1',
  models: [{ id: 'fixture', name: 'Fixture', reasoning: false, input: ['text'], cost, contextWindow: 64000, maxTokens: 4096 }],
  streamSimple(model) {
    const stream = createAssistantMessageEventStream();
    const partial = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { ...cost, totalTokens: 0, cost: { ...cost, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
    stream.push({ type: 'start', partial });
    const message = { ...partial, content: [{ type: 'text', text: 'STANDALONE_OK' }] };
    stream.push({ type: 'done', reason: 'stop', message });
    stream.end(message);
    return stream;
  },
});
"""


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def verify_archive(archive):
    with archive.open('rb') as contents:
        checksum = hashlib.file_digest(contents, 'sha256').hexdigest()
    checksums = archive.with_name('SHA256SUMS').read_text(encoding='utf-8').splitlines()
    require(f'{checksum}  {archive.name}' in checksums, f'Checksum mismatch: {archive.name}')
    print(f'{archive.name} sha256={checksum}', flush=True)


def check_pty(args, cwd, env):
    import fcntl
    import pty
    import select
    import struct
    import termios

    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 160, 0, 0))
    try:
        process = subprocess.Popen(args, cwd=cwd, env=env, stdin=slave, stdout=slave, stderr=slave)
    finally:
        os.close(slave)
    transcript = bytearray()

    def read_output(timeout):
        if not select.select([master], [], [], timeout)[0]:
            return
        try:
            data = os.read(master, 65536)
        except OSError as error:
            if error.errno != errno.EIO:
                raise
            data = b''
        require(data or process.poll() is not None, 'PTY closed its output unexpectedly')
        transcript.extend(data)

    try:
        deadline = time.monotonic() + 15
        while b'STANDALONE_OK' not in transcript and time.monotonic() < deadline and process.poll() is None:
            read_output(0.1)
        require(b'STANDALONE_OK' in transcript, 'The interactive turn did not complete')
        observed = set()
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline and process.poll() is None:
            start = len(transcript)
            os.write(master, b'/debug\r')
            sample_deadline = min(deadline, time.monotonic() + 1)
            while time.monotonic() < sample_deadline:
                read_output(0.1)
            sample = bytes(transcript[start:])
            if b'Loaded UI: bundled' in sample and b'renderer state: opentui-frame' in sample:
                break
            observed.update(line.split(b'renderer state: ', 1)[1].split(b'\x1b', 1)[0].strip()
                            for line in sample.splitlines() if b'renderer state: ' in line)
            os.write(master, b'\x1b')
            read_output(0.25)
        else:
            raise SystemExit(f'No bundled OpenTUI frame; observed renderer states: {sorted(observed)}')
        os.write(master, b'\x1b')
        read_output(0.25)
        os.write(master, b'\x04')
        require(process.wait(timeout=5) == 0, 'PTY exit failed')
    finally:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        os.close(master)


def main(archive, target, version):
    system = {'linux': 'linux', 'darwin': 'darwin', 'win32': 'windows'}[sys.platform]
    machine = os.environ.get('PROCESSOR_ARCHITEW6432', platform.machine()).lower() if system == 'windows' else platform.machine().lower()
    arch = {'x86_64': 'x64', 'amd64': 'x64', 'arm64': 'arm64', 'aarch64': 'arm64'}.get(machine, machine)
    require(f'{system}-{arch}' == target, f'Runner is {system}-{arch}, expected {target}')
    is_windows = system == 'windows'
    filename = f'omk-{target}.zip' if is_windows else f'omk-{target}.tar.gz'
    require(archive.name == filename, f'Expected archive {filename}, got {archive.name}')
    verify_archive(archive)

    with tempfile.TemporaryDirectory(prefix='omk smoke ') as temp:
        root = Path(temp)
        work = root / 'work'
        work.mkdir()
        empty_path = root / 'empty-path'
        empty_path.mkdir()
        profile = root / 'profile'
        profile.mkdir()
        extracted = root / 'release'
        extracted.mkdir()
        if is_windows:
            with zipfile.ZipFile(archive) as packed:
                packed.extractall(extracted)
            exe = extracted / 'omk.exe'
        else:
            with tarfile.open(archive) as packed:
                packed.extractall(extracted, filter='data')
            exe = extracted / 'omk' / 'omk'

        env = {key: os.environ[key] for key in ('SystemRoot', 'WINDIR', 'ComSpec') if key in os.environ}
        env.update(HOME=str(profile), USERPROFILE=str(profile), TEMP=temp, TMP=temp, TMPDIR=temp,
                   PATH=str(empty_path), TERM='xterm-256color', OMK_CODING_AGENT_DIR=str(profile),
                   OMK_OFFLINE='1', OMK_SKIP_VERSION_CHECK='1', OMK_COMPLETION_SOUND='0')
        require(all(shutil.which(tool, path=env['PATH']) is None for tool in ('node', 'bun', 'npm', 'npx')),
                'An external JS runtime is visible to the standalone executable')
        fixture = work / 'provider.mjs'
        fixture.write_text(FIXTURE, encoding='utf-8')
        args = [str(exe), '--no-session', '--no-skills', '--no-context-files', '--extension', str(fixture),
                '--provider', 'standalone-fixture', '--model', 'fixture', 'offline smoke']

        def run(*command):
            result = subprocess.run(command, cwd=work, env=env, capture_output=True, text=True, encoding='utf-8',
                                    errors='replace', timeout=25)
            require(result.returncode == 0, f'Exit {result.returncode}: {result.stdout[-1000:]} {result.stderr[-1000:]}')
            return result.stdout.strip()

        require(run(str(exe), '--version') == version, f'Expected version {version}')
        help_text = run(str(exe), '--help')
        require('Usage:' in help_text and '--mode' in help_text, 'CLI help missing Usage or --mode')
        require(run(*args, '--print') == 'STANDALONE_OK', 'Bundled extension did not complete the offline turn')
        print(f'{target}: version, help, and offline turn passed', flush=True)
        # shortcut: no Windows PTY coverage; add a verified ConPTY driver to gate its OpenTUI rendering.
        if not is_windows:
            check_pty(args, work, env)
            print(f'{target}: bundled OpenTUI frame and clean exit passed', flush=True)


if __name__ == '__main__':
    require(len(sys.argv) == 4, 'Usage: standalone-native-smoke.py ARCHIVE TARGET VERSION')
    main(Path(sys.argv[1]).resolve(), sys.argv[2], sys.argv[3])
