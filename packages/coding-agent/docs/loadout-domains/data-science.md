# Data Science & Analysis (`data-science`)

> Inherited domain capability document. Auto-generated from `src/core/domain-loadouts.ts` — do not edit by hand.


## Identity

| field | value |
|---|---|
| id | `data-science` |
| authority | `execute-tests` |
| tools | read, grep, find, ls, bash |
| command mode | `tests-only` |

## Routing prompt

> Prepended to the lane task prompt when the router selects this domain.

```text
DOMAIN: Data Science & Analysis. You are operating in an analysis/modeling capability lane.
Prioritize correct statistical reasoning, reproducibility, and honest uncertainty.

SEQUENCE:
1. Start with exploratory-data-analysis: shape, dtypes, missingness, distributions, basic sanity checks — never skip straight to modeling.
2. Pick the dataframe engine by size: polars for in-memory speed, dask for larger-than-RAM. Do not reach for pandas by reflex.
3. Visualization: seaborn/plotly for exploration, scientific-visualization for publication figures (colorblind-safe, correct error bars, journal styling).
4. Modeling: scikit-learn for classical, pytorch-lightning for DL. State assumptions, then validate with statistical-analysis (right test, assumption checks, power). Bayesian work uses pymc; report with statsmodels.
5. Interpretability: shap for global/local explanations; do not ship a black box without them.
6. Reproducibility: fix seeds, pin versions, commit the exact data hash. Prefer scripts/functions over ad-hoc notebook cells for anything reused.

HARD RULES: report effect size + CI, not just p-values; never train on test; never impute silently; notebooks are for exploration, modules are for production.
```

## Curated skills (25)

- `exploratory-data-analysis`
- `polars`
- `dask`
- `matplotlib`
- `seaborn`
- `plotly`
- `scientific-visualization`
- `scikit-learn`
- `pytorch-lightning`
- `transformers`
- `networkx`
- `pymc`
- `statsmodels`
- `sympy`
- `statistical-analysis`
- `shap`
- `rdkit`
- `biopython`
- `scanpy`
- `astropy`
- `qiskit`
- `deepchem`
- `molecular-dynamics`
- `hypothesis-generation`
- `literature-review`

## Curated MCP servers (3)

- `filesystem`
- `memory`
- `context7`

## Curated hooks (3)

- `pre-shell-guard`
- `protect-secrets`
- `stop-verify`

## Routing triggers (24)

| kind | pattern | weight |
|---|---|---|
| keyword | `data` | 3 |
| keyword | `analysis` | 4 |
| keyword | `dataframe` | 5 |
| keyword | `model` | 2 |
| keyword | `training` | 4 |
| keyword | `dataset` | 5 |
| keyword | `vector search` | 6 |
| keyword | `statistics` | 5 |
| keyword | `regression` | 4 |
| keyword | `classification` | 4 |
| keyword | `visualization` | 5 |
| keyword | `plot` | 4 |
| keyword | `notebook` | 5 |
| keyword | `pandas` | 6 |
| keyword | `polars` | 6 |
| keyword | `numpy` | 5 |
| keyword | `pytorch` | 6 |
| keyword | `tensorflow` | 5 |
| keyword | `scikit` | 6 |
| keyword | `bayesian` | 5 |
| regex | `\b(eda|ml|machine learning|inference|embeddings?)\b` | 5 |
| extension | `.ipynb` | 7 |
| path | `notebooks/` | 6 |
| path | `models/` | 3 |
