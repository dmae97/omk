/** Deterministic, local-only MCP stdio fixture. No network, filesystem writes, or external credentials. */
import { createInterface } from 'node:readline';
const input = createInterface({input: process.stdin, crlfDelay: Infinity});
const reply = (id,result) => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\n');
input.on('line', line => {
    let request; try { request=JSON.parse(line); } catch { return; }
    if (!Object.hasOwn(request,'id')) return;
    if (request.method === 'initialize') reply(request.id,{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'audit-fixture',version:'1.0'}});
    else if (request.method === 'tools/list') reply(request.id,{tools:[{name:'echo',description:'Deterministic fixture',inputSchema:{type:'object'}}]});
    else if (request.method === 'ping') reply(request.id,{});
    else if (request.method === 'tools/call') {
        const args=request.params?.arguments ?? {};
        const result=Object.hasOwn(args,'rawResult') ? args.rawResult : {content:[{type:'text',text:'ok'}],isError:false};
        if (args.delayMs > 0) setTimeout(() => reply(request.id,result),args.delayMs);
        else reply(request.id,result);
    } else process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Unknown method'}})+'\n');
});
input.on('close',() => process.exit(0));
