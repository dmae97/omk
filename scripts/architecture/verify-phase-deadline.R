args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 1L) stop("usage: Rscript verify-phase-deadline.R fixture.csv")
cases <- read.csv(args[[1]], colClasses = "character", stringsAsFactors = FALSE, check.names = FALSE)
if (!identical(names(cases), c("uptime", "deadlineMs", "upperMs", "status")) || nrow(cases) < 1L) stop("invalid cases")
limit <- 2^53 - 1
for (i in seq_len(nrow(cases))) {
  row <- cases[i, ]
  upper <- NA_real_
  if (grepl("^[0-9]+[.][0-9]{2}$", row$uptime)) {
    parts <- strsplit(row$uptime, ".", fixed = TRUE)[[1]]
    # Count completed centisecond buckets plus the current bucket, independently
    # of the Rust seconds-to-milliseconds implementation.
    upper <- (as.numeric(parts[[1]]) * 100 + as.numeric(parts[[2]]) + 1) * 10
    if (!is.finite(upper) || upper > limit) upper <- NA_real_
  }
  deadline <- as.numeric(row$deadlineMs)
  if (!is.finite(deadline) || deadline < 1 || deadline > limit || deadline != floor(deadline)) stop("invalid deadline")
  verdict <- if (is.na(upper)) "clock_unavailable" else if (upper >= deadline) "deadline" else "ok"
  if (!identical(verdict, row$status)) stop(sprintf("case %d status mismatch", i))
  if (!is.na(upper) && upper != as.numeric(row$upperMs)) stop(sprintf("case %d upper mismatch", i))
}
cat(sprintf("PASS phase_deadline_cases=%d exact_integer_decisions=true\n", nrow(cases)))
