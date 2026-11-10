use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PhaseDeadline {
    pub boot_id: String,
    pub deadline_ms: u64,
}

fn uptime_upper_ms(text: &str) -> Result<u64, &'static str> {
    let (seconds, hundredths) = text
        .split_whitespace()
        .next()
        .and_then(|value| value.split_once('.'))
        .ok_or("clock_unavailable")?;
    if hundredths.len() != 2 || !hundredths.bytes().all(|b| b.is_ascii_digit()) {
        return Err("clock_unavailable");
    }
    // /proc/uptime truncates to centiseconds. Use its upper bound so quantization
    // can stop up to 10 ms early, never extend the original deadline.
    seconds
        .parse::<u64>()
        .ok()
        .and_then(|s| s.checked_mul(1000))
        .and_then(|s| {
            hundredths
                .parse::<u64>()
                .ok()
                .and_then(|h| s.checked_add(h * 10 + 10))
        })
        .filter(|ms| *ms <= 9_007_199_254_740_991)
        .ok_or("clock_unavailable")
}

impl PhaseDeadline {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.boot_id.len() != 36
            || !self.boot_id.bytes().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) {
                    b == b'-'
                } else {
                    b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
                }
            })
            || self.deadline_ms == 0
            || self.deadline_ms > 9_007_199_254_740_991
        {
            return Err("clock_unavailable");
        }
        Ok(())
    }

    pub fn check(&self) -> Result<(), &'static str> {
        let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id")
            .map_err(|_| "clock_unavailable")?;
        let uptime = fs::read_to_string("/proc/uptime").map_err(|_| "clock_unavailable")?;
        self.check_at(boot.trim(), uptime_upper_ms(&uptime)?)
    }

    fn check_at(&self, boot: &str, now_ms: u64) -> Result<(), &'static str> {
        if boot != self.boot_id {
            return Err("clock_changed");
        }
        if now_ms >= self.deadline_ms {
            return Err("deadline");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_proc_clock_without_rounding_down_or_overflowing() {
        assert_eq!(uptime_upper_ms("10.00 0.00\n"), Ok(10_010));
        assert_eq!(uptime_upper_ms("10.99 99.99\n"), Ok(11_000));
        for text in [
            "",
            "NaN",
            "1.1",
            "1.000",
            "-1.00",
            "1.xx",
            "9007199254740991.00",
        ] {
            assert_eq!(uptime_upper_ms(text), Err("clock_unavailable"));
        }
    }
    #[test]
    fn deadline_is_inclusive_boot_bound_and_never_reset() {
        let deadline = PhaseDeadline {
            boot_id: "0123abcd-0000-4000-8000-00000000beef".into(),
            deadline_ms: 100,
        };
        assert_eq!(deadline.check_at(&deadline.boot_id, 99), Ok(()));
        assert_eq!(deadline.check_at(&deadline.boot_id, 100), Err("deadline"));
        assert_eq!(deadline.check_at(&deadline.boot_id, 101), Err("deadline"));
        assert_eq!(deadline.check_at("other", 1), Err("clock_changed"));
    }
}
