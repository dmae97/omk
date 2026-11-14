options(warn = 2)
assert <- function(ok, message) {
  if (!isTRUE(ok)) stop(message, call. = FALSE)
}
args <- commandArgs(trailingOnly = TRUE)
assert(length(args) == 1L, "Usage: Rscript --vanilla verify-fixtures.R <bundle>")
cat("R ORACLE", R.version.string, "\n")
cap <- 16777216

table_input <- function(file, columns) {
  path <- file.path(args[1L], file)
  lines <- readLines(path, warn = FALSE)
  assert(length(lines) > 1L && all(nzchar(lines)), paste(file, "empty input"))
  assert(all(lengths(strsplit(lines, "\t", fixed = TRUE)) == length(columns)), paste(file, "column count"))
  data <- read.delim(path, sep = "\t", quote = "", comment.char = "", colClasses = "character",
                     check.names = FALSE, na.strings = NULL, fill = FALSE, blank.lines.skip = FALSE)
  assert(identical(names(data), columns) && all(!is.na(data) & nzchar(as.matrix(data))), paste(file, "schema"))
  data
}
numbers <- function(text, low = 0, high = 2^53 - 1) {
  assert(all(grepl("^-?(0|[1-9][0-9]*)$", text)), "non-integer numeric field")
  values <- as.numeric(text)
  assert(all(is.finite(values) & values >= low & values <= high), "numeric field range")
  values
}
allocation <- function(n) {
  if (n == 0) return(0)
  q <- floor((n - 1) / 32)
  r <- (n - 1) %% 32
  4 * (16 * q * (q + 1) + (q + 1) * r)
}
decode <- function(text, n) {
  if (n == 0) {
    assert(identical(text, "~"), "DAG empty encoding")
    return(list())
  }
  rows <- strsplit(text, "/", fixed = TRUE)[[1L]]
  assert(length(rows) == n, "DAG row count")
  graph <- lapply(seq_len(n), function(target) {
    if (rows[target] == "-") return(numeric())
    assert(grepl("^(0|[1-9][0-9]*)(,(0|[1-9][0-9]*))*$", rows[target]), "DAG predecessors encoding")
    values <- as.numeric(strsplit(rows[target], ",", fixed = TRUE)[[1L]])
    assert(all(is.finite(values) & values >= 0 & values < target - 1) && all(diff(values) > 0), "DAG predecessors range/order")
    values
  })
  assert(identical(encode(graph), text), "DAG canonical encoding")
  graph
}
encode <- function(graph) {
  if (!length(graph)) return("~")
  paste(vapply(graph, function(row) if (!length(row)) "-" else paste(row, collapse = ","), ""), collapse = "/")
}
adjacency <- function(graph) {
  matrix <- matrix(FALSE, length(graph), length(graph))
  for (target in seq_along(graph)) matrix[graph[[target]] + 1, target] <- TRUE
  matrix
}
warshall <- function(reach) {
  for (k in seq_len(nrow(reach))) reach <- reach | outer(reach[, k], reach[k, ], "&")
  reach
}
check_reduction <- function(input, output) {
  a <- adjacency(input)
  b <- adjacency(output)
  assert(all(!b | a), "DAG subgraph")
  closure <- warshall(b)
  assert(identical(warshall(a), closure), "DAG closure preservation")
  for (target in seq_along(output)) for (predecessor in output[[target]]) {
    removed <- b
    removed[predecessor + 1, target] <- FALSE
    assert(!identical(warshall(removed), closure), "DAG minimality redundant edge")
  }
}
example <- function(kind) {
  n <- switch(kind, empty = 0, chain = 16, diamond = 4, layered = 24, dense = 20, disconnected = 12, word32 = 34, word64 = 66)
  lapply(seq_len(n), function(index) {
    i <- index - 1
    switch(kind,
      chain = if (i) i - 1 else numeric(),
      diamond = list(numeric(), 0, 0, c(0, 1, 2))[[index]],
      layered = seq_len(floor(i / 6) * 6) - 1,
      dense = seq_len(i) - 1,
      disconnected = seq_len(i %% 4) + i - i %% 4 - 1,
      word32 = switch(as.character(i), `30` = 0, `31` = 0, `32` = c(0, 30, 31), `33` = c(0, 30, 31, 32), numeric()),
      word64 = switch(as.character(i), `31` = 0, `32` = 0, `63` = c(0, 31, 32), `64` = c(31, 32, 63),
                      `65` = c(0, 31, 32, 63, 64), numeric()))
  })
}

dag <- table_input("dag.tsv", c("graph_id", "kind", "n", "mask", "budget", "predecessors", "reduced", "strategy", "closure_bytes"))
assert(!anyDuplicated(paste(dag$graph_id, dag$budget)), "DAG duplicate case")
dag$graph_id <- numbers(dag$graph_id, 0, 1106)
dag$n <- numbers(dag$n, 0, 66)
dag$mask <- numbers(dag$mask, -1, 1023)
dag$budget <- numbers(dag$budget, 0, cap)
dag$closure_bytes <- numbers(dag$closure_bytes)
assert(nrow(dag) == 2214 && setequal(dag$graph_id, 0:1106) && all(dag$budget %in% c(0, cap)), "DAG coverage")
special <- c("empty", "chain", "diamond", "layered", "dense", "disconnected", "word32", "word64")
assert(all(dag$kind %in% c("exhaustive", special)), "DAG kind")
for (id in unique(dag$graph_id)) {
  pair <- dag[dag$graph_id == id, ]
  assert(nrow(pair) == 2 && setequal(pair$budget, c(0, cap)), "DAG coverage budgets")
  assert(all(vapply(c("kind", "n", "mask", "predecessors"), function(k) length(unique(pair[[k]])) == 1L, TRUE)), "DAG budget parity")
}
corpus <- dag[dag$budget == 0, ]
for (n in 1:5) {
  masks <- corpus$mask[corpus$kind == "exhaustive" & corpus$n == n]
  expected <- 0:(2^(n * (n - 1) / 2) - 1)
  assert(length(masks) == length(expected) && setequal(masks, expected), "DAG coverage exhaustive masks")
}
assert(sum(corpus$kind == "exhaustive") == 1099 && all(table(factor(corpus$kind, levels = special)) == 1), "DAG coverage examples")
for (i in seq_len(nrow(dag))) {
  row <- dag[i, ]
  input <- decode(row$predecessors, row$n)
  output <- decode(row$reduced, row$n)
  if (row$kind == "exhaustive") {
    mask <- sum(vapply(seq_along(input), function(target) sum(2^((target - 1) * (target - 2) / 2 + input[[target]])), 0))
    assert(row$n %in% 1:5 && row$mask == mask, "DAG coverage mask identity")
  } else {
    assert(row$mask == -1 && row$predecessors == encode(example(row$kind)), "DAG example identity")
  }
  check_reduction(input, output)
  children <- tabulate(unlist(input) + 1, nbins = row$n)
  strategy <- if (!any(lengths(input) > 1) || !any(children > 1)) "already-reduced" else if (row$budget == 0) "traversal" else "bitset"
  assert(row$strategy == strategy && row$closure_bytes == if (strategy == "bitset") allocation(row$n) else 0, "DAG diagnostics")
}
for (id in unique(dag$graph_id)) {
  assert(length(unique(dag$reduced[dag$graph_id == id])) == 1L, "DAG budget reduction parity")
}

memory <- table_input("memory.tsv", c("n", "budget", "sum_bytes", "strategy", "closure_bytes", "predecessors", "reduced"))
sizes <- c(4, 31, 32, 33, 64, 512, 16369, 16370)
assert(!anyDuplicated(paste(memory$n, memory$budget)), "memory duplicate")
for (field in c("n", "budget", "sum_bytes", "closure_bytes")) memory[[field]] <- numbers(memory[[field]])
assert(nrow(memory) == 16 && setequal(paste(memory$n, memory$budget), as.vector(outer(sizes, c(0, cap), paste))), "memory coverage")
assert(allocation(16369) == cap && allocation(16370) == 16779264, "memory cap boundary")
for (i in seq_len(nrow(memory))) {
  row <- memory[i, ]
  assert(row$sum_bytes == allocation(row$n), "memory formula direct sum vs closed form")
  strategy <- if (allocation(row$n) <= row$budget) "bitset" else "traversal"
  bytes <- if (strategy == "bitset") allocation(row$n) else 0
  assert(row$strategy == strategy && row$closure_bytes == bytes && row$closure_bytes <= row$budget, "memory allocation strategy/cap")
  input <- decode(row$predecessors, row$n)
  output <- decode(row$reduced, row$n)
  expected <- lapply(seq_len(row$n), function(j) if (j == 4) c(0, 1, 2) else if (j == 3) 0 else if (j > 1) j - 2 else numeric())
  assert(encode(input) == encode(expected), "memory redundant sparse graph identity")
  expected[[4]] <- c(1, 2)
  assert(encode(output) == encode(expected), "memory sparse reduction")
}

invalid <- table_input("invalid.tsv", c("case", "accepted", "error_class"))
invalid_cases <- c("nonarray_graph", "sparse_rows", "nonarray_row", "sparse_predecessors", "duplicate", "unsorted", "future",
                   "self", "negative", "fractional", "budget_negative", "budget_fractional", "budget_nan", "budget_infinity", "budget_overcap")
assert(nrow(invalid) == length(invalid_cases) && !anyDuplicated(invalid$case) && setequal(invalid$case, invalid_cases), "invalid coverage")
assert(all(numbers(invalid$accepted, 0, 1) == 0) && all(invalid$error_class == "RangeError"), "invalid rejection (observed JS shape behavior)")

wpl <- table_input("wpl.tsv", c("from", "to", "allowed", "terminal"))
expected <- list(
  DRAFTED = "ROUTED",
  ROUTED = c("AWAITING_APPROVAL", "DISPATCHED"),
  AWAITING_APPROVAL = c("DISPATCHED", "CLOSED"),
  DISPATCHED = c("ACTIVE", "RAW_TERMINAL", "CLOSED"),
  ACTIVE = c("RAW_TERMINAL", "HALTING", "CLOSED"),
  HALTING = c("RAW_TERMINAL", "CLOSED"),
  RAW_TERMINAL = c("UNDER_REVIEW", "ADJUDICATION_FAILED"),
  UNDER_REVIEW = c("ADJUDICATION_FAILED", "CONFIRMED", "DECLINED"),
  ADJUDICATION_FAILED = c("UNDER_REVIEW", "ESCALATED"),
  CONFIRMED = "CLOSED",
  DECLINED = c("ESCALATED", "RETRY_QUEUED", "CLOSED"),
  RETRY_QUEUED = "ROUTED",
  ESCALATED = c("RETRY_QUEUED", "CLOSED"),
  CLOSED = character())
states <- names(expected)
assert(nrow(wpl) == length(states)^2 && !anyDuplicated(paste(wpl$from, wpl$to)) &&
         setequal(paste(wpl$from, wpl$to), as.vector(outer(states, states, paste))), "WPL coverage")
allowed <- numbers(wpl$allowed, 0, 1)
terminal <- numbers(wpl$terminal, 0, 1)
assert(all(allowed == vapply(seq_len(nrow(wpl)), function(i) as.numeric(wpl$to[i] %in% expected[[wpl$from[i]]]), 0)), "WPL transitions")
assert(all(terminal == as.numeric(wpl$from == "CLOSED")), "WPL terminal sole CLOSED")
reach <- matrix(FALSE, length(states), length(states))
reach[cbind(match(wpl$from, states), match(wpl$to, states))] <- allowed == 1
assert(all(warshall(reach)[, match("CLOSED", states)] | states == "CLOSED"), "WPL existential reachability to CLOSED")
cat("PASS graphs=1107 dag_cases=2214 memory_cases=16 invalid_cases=15 states=14 pairs=196\n")
