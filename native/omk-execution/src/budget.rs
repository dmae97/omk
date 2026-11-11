#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stop {
    Deadline,
    OutputLimit,
    ClockRegression,
}

impl Stop {
    pub fn code(self) -> &'static str {
        match self {
            Self::Deadline => "deadline",
            Self::OutputLimit => "output_limit",
            Self::ClockRegression => "clock_regression",
        }
    }
}

pub struct Budget {
    timeout: u64,
    limit: u64,
    elapsed: u64,
    retained: u64,
    stopped: Option<Stop>,
}

impl Budget {
    pub fn new(timeout: u64, limit: u64) -> Result<Self, &'static str> {
        if timeout == 0 || timeout > 86_400_000 || limit > 16_777_216 {
            return Err("budget");
        }
        Ok(Self {
            timeout,
            limit,
            elapsed: 0,
            retained: 0,
            stopped: None,
        })
    }

    pub fn observe(&mut self, elapsed: u64, bytes: u64) -> Option<Stop> {
        if self.stopped.is_some() {
            return self.stopped;
        }
        self.stopped = if elapsed < self.elapsed {
            Some(Stop::ClockRegression)
        } else if elapsed >= self.timeout {
            Some(Stop::Deadline)
        } else if bytes > self.limit - self.retained {
            Some(Stop::OutputLimit)
        } else {
            self.retained += bytes;
            None
        };
        self.elapsed = elapsed;
        self.stopped
    }

    pub fn retained(&self) -> u64 {
        self.retained
    }
}
