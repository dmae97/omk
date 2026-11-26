use reqwest::{Client, Url, header::HeaderMap};
use std::{
    fmt,
    future::{Future, poll_fn},
    task::Poll,
};
use tokio::{
    sync::watch,
    time::{Instant, timeout_at},
};

/// Irreversible cancellation shared by a request owner and its caller.
#[derive(Clone)]
pub struct Cancellation(watch::Sender<bool>);
impl Default for Cancellation {
    fn default() -> Self {
        Self(watch::channel(false).0)
    }
}
impl Cancellation {
    pub fn cancel(&self) {
        self.0.send_replace(true);
    }
    async fn cancelled(&self) {
        let mut receiver = self.0.subscribe();
        while !*receiver.borrow_and_update() {
            if receiver.changed().await.is_err() {
                break;
            }
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Error {
    InvalidRequest,
    Cancelled,
    Deadline,
    Network,
    ResponseTooLarge,
    Sink,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidRequest => "invalid HTTP request",
            Self::Cancelled => "HTTP request cancelled",
            Self::Deadline => "HTTP request deadline exceeded",
            Self::Network => "HTTP connection or body failed",
            Self::ResponseTooLarge => "HTTP response byte limit exceeded",
            Self::Sink => "HTTP response consumer failed",
        })
    }
}
impl std::error::Error for Error {}

pub struct Limits {
    pub deadline: Instant,
    pub max_response_bytes: usize,
}
#[derive(Debug)]
pub struct Response {
    pub status: u16,
    pub headers: HeaderMap,
}

/// Explicit single-attempt transport. It neither resolves auth nor owns provider retry policy.
pub struct Transport(Client);
impl Transport {
    pub fn new() -> Result<Self, String> {
        super::transport::build_client().map(Self)
    }

    /// Streams bytes synchronously to the consumer without collecting the response.
    /// Dropping this future cancels local I/O, not server-side work already accepted.
    pub async fn post(
        &self,
        endpoint: &str,
        headers: HeaderMap,
        body: Vec<u8>,
        limits: Limits,
        cancellation: &Cancellation,
        mut on_chunk: impl FnMut(&Response, &[u8]) -> Result<(), ()>,
    ) -> Result<Response, Error> {
        if *cancellation.0.borrow() {
            return Err(Error::Cancelled);
        }
        if Instant::now() >= limits.deadline {
            return Err(Error::Deadline);
        }
        let url = Url::parse(endpoint).map_err(|_| Error::InvalidRequest)?;
        let loopback = url
            .host_str()
            .and_then(|host| {
                host.trim_matches(['[', ']'])
                    .parse::<std::net::IpAddr>()
                    .ok()
            })
            .is_some_and(|ip| ip.is_loopback());
        if !(url.scheme() == "https" || url.scheme() == "http" && loopback)
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || body.len() > 8 * 1024 * 1024
            || limits.max_response_bytes > 8 * 1024 * 1024
            || headers.contains_key(reqwest::header::CONTENT_LENGTH)
            || headers.contains_key(reqwest::header::TRANSFER_ENCODING)
        {
            return Err(Error::InvalidRequest);
        }
        let request = self
            .0
            .post(url)
            .headers(headers)
            .body(body)
            .build()
            .map_err(|_| Error::InvalidRequest)?;
        let operation = async {
            let mut response = self.0.execute(request).await.map_err(|e| {
                if e.is_timeout() {
                    Error::Deadline
                } else {
                    Error::Network
                }
            })?;
            let metadata = Response {
                status: response.status().as_u16(),
                headers: response.headers().clone(),
            };
            if response
                .content_length()
                .is_some_and(|n| n > limits.max_response_bytes as u64)
            {
                return Err(Error::ResponseTooLarge);
            }
            let mut total = 0usize;
            while let Some(chunk) = response.chunk().await.map_err(|e| {
                if e.is_timeout() {
                    Error::Deadline
                } else {
                    Error::Network
                }
            })? {
                if *cancellation.0.borrow() {
                    return Err(Error::Cancelled);
                }
                if Instant::now() >= limits.deadline {
                    return Err(Error::Deadline);
                }
                total = total
                    .checked_add(chunk.len())
                    .filter(|n| *n <= limits.max_response_bytes)
                    .ok_or(Error::ResponseTooLarge)?;
                on_chunk(&metadata, &chunk).map_err(|_| Error::Sink)?;
            }
            if *cancellation.0.borrow() {
                return Err(Error::Cancelled);
            }
            if Instant::now() >= limits.deadline {
                return Err(Error::Deadline);
            }
            Ok(metadata)
        };
        let mut operation = std::pin::pin!(timeout_at(limits.deadline, operation));
        let mut cancelled = std::pin::pin!(cancellation.cancelled());
        poll_fn(|cx| {
            if cancelled.as_mut().poll(cx).is_ready() {
                return Poll::Ready(Err(Error::Cancelled));
            }
            operation
                .as_mut()
                .poll(cx)
                .map(|outcome| outcome.unwrap_or(Err(Error::Deadline)))
        })
        .await
    }
}
