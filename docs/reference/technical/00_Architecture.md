# Technical Architecture: TIVA/TCI iOS App

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────┐
│                  SwiftUI App                     │
│  ┌───────────┐  ┌───────────┐  ┌─────────────┐ │
│  │   Views    │  │ ViewModels│  │   Models    │ │
│  │ (SwiftUI)  │◄─┤  (MVVM)  │◄─┤ (Swift)     │ │
│  └───────────┘  └─────┬─────┘  └─────────────┘ │
│                       │                          │
│                ┌──────▼──────┐                   │
│                │ EngineBridge│  ← Swift wrapper   │
│                │  (C-FFI)    │                    │
│                └──────┬──────┘                   │
├───────────────────────┼─────────────────────────┤
│                ┌──────▼──────┐                   │
│                │  pk-engine  │  ← Rust static lib│
│                │  (.a / .xcf)│    (aarch64-ios)  │
│                └─────────────┘                   │
└─────────────────────────────────────────────────┘
```

## 2. Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| UI Framework | SwiftUI (iOS 17+) | Declarative, Canvas API for animations |
| Architecture | MVVM + Observable | Native SwiftUI pattern, clean separation |
| Charting | Custom SwiftUI Canvas | Dual Y-axes, draggable nodes, scrubbing — no 3rd party lib supports all these interactions natively |
| Compartment Animation | SwiftUI Canvas + TimelineView | Particle systems, fluid levels, synced to timeline |
| Math Engine | Rust `pk-engine` crate via C-FFI | Performance-critical ODE solving, already proven in GroupPharma project |
| Local Storage | UserDefaults + SwiftData | Announcements state, saved simulations, drug database |
| Navigation | NavigationStack | Linear flow with back navigation |

## 3. Module Breakdown

### 3.1 Swift Side

```
PharmaApp/
├── App/
│   └── PharmaApp.swift              # @main entry point
├── Models/
│   ├── DrugModel.swift              # Drug + PK/PD model definitions
│   ├── PatientProfile.swift         # Patient biometric data
│   ├── SimulationState.swift        # Current sim state (targets, time, curves)
│   └── Announcement.swift           # Launch modal data
├── Views/
│   ├── LaunchModal/
│   │   └── LaunchModalView.swift
│   ├── DrugSelection/
│   │   └── DrugSelectionView.swift
│   ├── PatientInput/
│   │   └── PatientInputView.swift
│   ├── Simulation/
│   │   ├── SimulationView.swift     # Main graph view
│   │   ├── ChartCanvas.swift        # Custom Canvas for dual-axis chart
│   │   ├── TargetNodeOverlay.swift  # Draggable target circle
│   │   └── DataTooltip.swift        # Floating value display
│   └── Compartmental/
│       ├── CompartmentalView.swift
│       ├── CylinderView.swift       # Single compartment cylinder
│       ├── ParticleSystem.swift     # Animated drug particles
│       └── MiniChartView.swift      # Bottom timeline chart
├── ViewModels/
│   ├── LaunchModalViewModel.swift
│   ├── DrugSelectionViewModel.swift
│   ├── PatientInputViewModel.swift
│   ├── SimulationViewModel.swift    # Orchestrates engine calls
│   └── CompartmentalViewModel.swift
├── Engine/
│   ├── PKEngineBridge.swift         # Swift wrapper over C-FFI
│   ├── PKEngineTypes.swift          # Swift mirrors of Rust types
│   └── libpk_engine.a              # Compiled Rust static library
├── Resources/
│   ├── drug_models.json             # Drug database (ships with app)
│   └── Assets.xcassets
└── Utilities/
    ├── AcceleratingRepeatButton.swift  # Long-press stepper acceleration
    └── Constants.swift
```

### 3.2 Rust Side (separate repo/workspace)

```
pk-engine/
├── Cargo.toml
├── cbindgen.toml                    # Generates C header for Swift
├── build-ios.sh                     # Cross-compile for aarch64-apple-ios
├── src/
│   ├── lib.rs                       # Public API
│   ├── ffi.rs                       # extern "C" functions for Swift
│   ├── models/
│   │   ├── mod.rs
│   │   ├── marsh.rs                 # Propofol (Marsh)
│   │   ├── schnider.rs              # Propofol (Schnider)
│   │   ├── minto.rs                 # Remifentanil (Minto)
│   │   ├── hannivoort.rs            # Dexmedetomidine (Hannivoort)
│   │   └── eleveld.rs               # Propofol (Eleveld) — future
│   ├── tci.rs                       # TCI control algorithm
│   ├── solver.rs                    # ODE solvers (DP45, RK4)
│   └── types.rs                     # Shared data structures
└── include/
    └── pk_engine.h                  # Auto-generated C header
```

## 4. Data Flow

```
Screen Flow:
  Launch Modal → Drug Selection → Patient Input → Simulation ↔ Compartmental

Data Flow:
  DrugModel (from JSON) ──┐
                          ├──► SimulationViewModel ──► PKEngineBridge ──► Rust
  PatientProfile ─────────┘         │
                                    ▼
                          SimulationState (curves, values)
                                    │
                          ┌─────────┴─────────┐
                          ▼                   ▼
                   ChartCanvas        CompartmentalView
```

## 5. State Management

Global state via `@Observable` classes injected through SwiftUI environment:

| State Object | Scope | Contains |
|-------------|-------|----------|
| `AppState` | App-wide | Selected drug/model, patient profile, announcement status |
| `SimulationState` | Simulation + Compartmental | Time cursor, target concentration, computed curves, play/pause state |

## 6. Performance Constraints

| Operation | Target Latency | Approach |
|-----------|---------------|----------|
| Target node drag → readout update | < 16ms (60fps) | Rust computes single-point TCI on background thread, result published to main thread |
| Full curve recalculation | < 50ms | Rust computes full time-series (e.g., 3600 points for 60min at 1/sec) |
| Compartment animation frame | < 16ms | SwiftUI Canvas redraws from pre-computed state array, no math in render loop |
| Drug picker scroll → metadata update | < 8ms | Pre-loaded JSON, simple dictionary lookup |

## 7. FFI Strategy: Rust → Swift

### Option A: C-FFI + cbindgen (Recommended for v1)

Rust exposes `extern "C"` functions. `cbindgen` generates a `.h` header. Swift calls them directly.

```rust
// Rust side
#[no_mangle]
pub extern "C" fn pk_engine_simulate(
    input: *const SimulationInput,
    output: *mut SimulationOutput,
) -> i32
```

```swift
// Swift side
let result = pk_engine_simulate(&input, &output)
```

**Pros:** Zero overhead, no extra dependencies, battle-tested.
**Cons:** Manual memory management at boundary, C-compatible types only.

### Option B: UniFFI (Consider for v2)

Mozilla's UniFFI auto-generates Swift bindings from Rust. Richer type support (enums, strings, Vec). Slightly more setup but less manual FFI code.

## 8. Build Pipeline

```
1. Rust: cargo build --release --target aarch64-apple-ios
         → produces libpk_engine.a
2. cbindgen: generates include/pk_engine.h
3. Xcode: links libpk_engine.a + bridging header
4. SwiftUI: calls PKEngineBridge which wraps the C functions
```

The Rust library is compiled separately and the `.a` + `.h` are checked into the iOS project (or fetched via build script).
