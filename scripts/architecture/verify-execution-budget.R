options(warn = 2, scipen = 999, digits = 22)
args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) == 2L)
input <- read.delim(args[1], header = FALSE, sep = "\t", quote = "", comment.char = "",
                    colClasses = "character", na.strings = NULL, fill = FALSE)
stopifnot(ncol(input) == 4L, nrow(input) > 0L, !anyDuplicated(input[[1]]))
integer_values <- function(text) {
  stopifnot(all(grepl("^(0|[1-9][0-9]*)$", text)))
  value <- as.numeric(text)
  stopifnot(all(is.finite(value) & value >= 0 & value <= 2^53 - 1))
  value
}
expected <- vapply(seq_len(nrow(input)), function(i) {
  row <- input[i, ]
  timeout <- integer_values(row[[2]])
  limit <- integer_values(row[[3]])
  stopifnot(timeout >= 1, timeout <= 86400000, limit <= 16777216)
  pairs <- strsplit(row[[4]], ";", fixed = TRUE)[[1]]
  split <- strsplit(pairs, ",", fixed = TRUE)
  stopifnot(all(lengths(split) == 2L))
  elapsed <- integer_values(vapply(split, `[`, "", 1L))
  bytes <- integer_values(vapply(split, `[`, "", 2L))
  totals <- cumsum(bytes)
  stopifnot(all(totals <= 2^53 - 1))
  regressed <- c(FALSE, diff(elapsed) < 0)
  expired <- elapsed >= timeout
  exceeded <- totals > limit
  bad <- which(regressed | expired | exceeded)
  labels <- rep("continue", length(bytes))
  retained <- totals
  if (length(bad)) {
    first <- bad[1]
    reason <- if (regressed[first]) "clock_regression" else if (expired[first]) "deadline" else "output_limit"
    labels[first:length(bytes)] <- reason
    retained[first:length(bytes)] <- if (first == 1) 0 else totals[first - 1]
  }
  stopifnot(all(retained >= 0 & retained <= limit))
  paste(row[[1]], paste(paste(labels, retained, sep = ","), collapse = ";"), sep = "\t")
}, "")
actual <- readLines(args[2], warn = FALSE)
if (!identical(actual, unname(expected))) stop("execution budget oracle mismatch", call. = FALSE)
cat("R EXECUTION BUDGET", R.version.string, "\n")
cat("PASS traces=", length(expected), " exact_integer_decisions=true\n", sep = "")
