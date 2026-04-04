# pk-engine: Rust PK/PD Engine for iOS TIVA/TCI App

## Purpose

This crate provides the mathematical engine for a TIVA/TCI (Total Intravenous Anesthesia / Target Controlled Infusion) simulation iOS app. It compiles to a static library (`libpk_engine.a`) for `aarch64-apple-ios` and exposes a C-FFI interface consumed by a SwiftUI app.

## Context

This builds on the existing `pk-core` architecture from the GroupPharma project (`/Users/stanleysalvatierra/Desktop/2026/GroupPharma/code/mrgsolve/mrgsolve-gpu/`), which already has:
- A `PkModel` trait with `deriv()`, `n_cmt()`, `initial_state()`
- Dormand-Prince 4(5) adaptive ODE solver
- RK4 fixed-step solver
- Event-driven simulation (dose application between integration steps)
- Proven numerical accuracy (<0.4% vs mrgsolve reference)

## What's New vs GroupPharma

| GroupPharma (pk-core) | This project (pk-engine) |
|----------------------|--------------------------|
| 2-compartment models | **3-compartment + effect site** (4 state ODEs) |
| Population simulation (100k patients) | **Single patient, high-resolution time series** |
| R FFI (extendr) | **C FFI (cbindgen) for Swift** |
| Bolus-only dosing | **Bolus + continuous infusion** |
| Forward simulation only | **TCI control algorithm** (compute dose to hit target) |
| No real-time constraint | **< 5ms for TCI queries, < 50ms for full sim** |

## Deliverables

1. **Rust crate** `pk-engine` with:
   - 3-compartment + effect-site PK models (Marsh, Schnider, Minto, Hannivoort)
   - TCI algorithm (both plasma-targeting and effect-site-targeting)
   - C-FFI exports
   - `cbindgen`-generated header file
2. **Cross-compilation** script for `aarch64-apple-ios`
3. **Test suite** validating against published reference values
4. **Benchmark** confirming < 5ms TCI query, < 50ms full simulation

## Crate Structure

```
pk-engine/
├── Cargo.toml
├── cbindgen.toml
├── build-ios.sh
├── src/
│   ├── lib.rs              # Re-exports
│   ├── ffi.rs              # extern "C" functions
│   ├── types.rs            # Shared data structures
│   ├── solver.rs           # ODE solvers (copy/adapt from pk-core)
│   ├── tci.rs              # TCI control algorithm
│   └── models/
│       ├── mod.rs           # Model registry + PkModel trait
│       ├── marsh.rs         # Propofol (Marsh)
│       ├── schnider.rs      # Propofol (Schnider)
│       ├── minto.rs         # Remifentanil (Minto)
│       └── hannivoort.rs    # Dexmedetomidine (Hannivoort)
├── include/
│   └── pk_engine.h          # Auto-generated
└── tests/
    ├── marsh_test.rs
    ├── schnider_test.rs
    ├── tci_test.rs
    └── ffi_test.rs
```

## Dependencies

```toml
[dependencies]
# From pk-core patterns:
thiserror = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# No rayon needed (single patient)
# No GPU needed (single patient, already fast enough on CPU)

[lib]
crate-type = ["staticlib"]  # produces .a for iOS linking
```
