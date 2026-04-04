# TivaTrainer — TIVA/TCI Simulation App for iOS

A pharmacokinetic simulation tool for anesthesiologists. Calculates and visualizes drug concentration profiles for Total Intravenous Anesthesia (TIVA) using Target Controlled Infusion (TCI) algorithms.

## What It Does

An anesthesiologist selects a drug model, enters patient biometrics, sets target concentrations, and the app instantly computes:

- **Bolus dose** needed to reach the target
- **Infusion rate** to maintain it
- **Concentration curves** (plasma Cp, effect-site Ce) over time
- **Compartmental visualization** of drug distribution in the body (2D schematic + 3D SceneKit)

### Supported Drug Models

| Drug | Model | Covariates | Concentration Unit |
|------|-------|------------|-------------------|
| Propofol | Marsh (1991) | Weight | mcg/ml |
| Propofol | Schnider (1998) | Weight, Height, Age, Gender (LBM) | mcg/ml |
| Remifentanil | Minto (1997) | Weight, Height, Age, Gender (LBM) | ng/ml |
| Dexmedetomidine | Hannivoort (2015) | Weight | ng/ml |

All models implement the 3-compartment mammillary model + effect site (4-state ODE system).

## Screens

1. **Launch Modal** — announcements overlay on first launch
2. **Drug Selection** — picker wheel with color-coded metadata cards, publication links
3. **Patient Input** — biometric steppers with validation, preparation recipes
4. **Simulation Graph** — interactive dual-axis chart with draggable target node, multiple targets, TCI readouts, playback controls
5. **Compartmental Animation** — 2D/3D toggle: Canvas schematic or SceneKit glass cylinders with fluid fills and particle flow

## Architecture

```
SwiftUI (iOS 17+)  ──►  PKEngineProtocol  ──►  MockPKEngine (RK4 ODE solver)
                                           └──►  RustPKEngine (future, C-FFI)
```

- **MVVM** with `@Observable` and SwiftUI environment
- **Protocol-based engine** — swap `MockPKEngine` ↔ `RustPKEngine` via single toggle
- **Mock engine** implements a real RK4 solver with all 4 pharmacokinetic models
- **Rust engine** spec ready for parallel development (see `docs/rust-engine-spec/`)

## Project Structure

```
pharma-app/
├── PharmaApp/
│   ├── App/                    # Entry point, AppState, navigation
│   ├── Models/                 # DrugModel, PatientProfile, SimulationTypes
│   ├── Engine/                 # PKEngineProtocol, MockPKEngine, RustPKEngine stub
│   ├── ViewModels/             # SimulationViewModel, CompartmentalViewModel
│   ├── Views/
│   │   ├── LaunchModal/
│   │   ├── DrugSelection/
│   │   ├── PatientInput/
│   │   ├── Simulation/         # ChartCanvas, DataTooltip, SimulationView
│   │   └── Compartmental/      # 2D Canvas, 3D SceneKit, CompartmentalView
│   ├── Utilities/              # DesignSystem, StepperRow
│   └── Resources/
│       ├── drug_models.json    # Drug database
│       └── MockData/           # Pre-computed simulation JSON snapshots
├── docs/
│   ├── 00-07_*.md              # Functional requirements
│   ├── technical/              # Architecture, screen guide, FFI integration
│   ├── rust-engine-spec/       # Full spec for Rust backend (models, TCI, FFI contract)
│   └── uiux/                   # UI/UX improvement plans
├── project.yml                 # XcodeGen project definition
├── generate_mock_data.swift    # Standalone script to regenerate mock JSON data
└── TODO.md                     # Build progress tracker
```

## Getting Started

### Prerequisites

- Xcode 16+ with iOS 17 SDK
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)

### Build & Run

```bash
# Generate Xcode project
xcodegen generate

# Open in Xcode
open PharmaApp.xcodeproj

# Select your team in Signing & Capabilities, pick a device, Cmd+R
```

### Generate Mock Data

The app ships with pre-computed simulation snapshots. To regenerate:

```bash
swift generate_mock_data.swift
# Outputs 5 JSON files to PharmaApp/Resources/MockData/
```

### TestFlight

```bash
# Bump build number for each upload
# Edit project.yml: CURRENT_PROJECT_VERSION: 2
xcodegen generate
# Xcode → Product → Archive → Distribute App → TestFlight
```

## Rust Engine Integration (Future)

The math engine is designed to be replaced by a Rust static library for production accuracy and performance. The full spec is in `docs/rust-engine-spec/`:

| Document | Contents |
|----------|----------|
| `00_Overview.md` | Crate structure, dependencies, deliverables |
| `01_Models.md` | ODE system, parameter equations for all 4 models, `TivaModel` trait |
| `02_TCI_Algorithm.md` | BET scheme, effect-site targeting, simulation loop pseudocode |
| `03_FFI_Contract.md` | `#[repr(C)]` types, exported functions, `cbindgen` config |
| `04_Validation_Reference.md` | Hand-calculated reference values, test cases |

To integrate:

1. Build `pk-engine` crate: `cargo build --release --target aarch64-apple-ios`
2. Generate header: `cbindgen --output include/pk_engine.h`
3. Implement `RustPKEngine.swift` (C-FFI calls matching `PKEngineProtocol`)
4. Set `EngineProvider.useMock = false`

## Key Technical Details

### Mock Engine

The `MockPKEngine` is not fake data — it implements a **real 4th-order Runge-Kutta ODE solver** with the actual pharmacokinetic equations from the published papers. It computes:

- 3-compartment model with effect site (4-state ODE)
- BET (Bolus-Elimination-Transfer) TCI algorithm
- Patient-specific parameter calculations from covariates

Performance: single-patient 60-minute simulation at 1-second resolution completes in ~50ms on device.

### Chart Rendering

Custom `SwiftUI Canvas` with:
- Dual Y-axes (concentration + infusion rate)
- Infusion rate as filled semi-transparent area
- Inline curve labels (Cp, Ce)
- Draggable target node with 44pt glow ring and haptic snap
- Horizontal dashed target lines
- Triangle markers on X-axis for each target
- Floating tooltip that follows cursor

### 3D Compartmental View

SceneKit implementation with:
- `SCNCylinder` glass compartments (physically-based rendering)
- Inner fluid cylinders with animated height
- `SCNParticleSystem` along pipes between compartments
- Directional lighting with shadows
- Turntable camera orbit control
- Toggle between 2D schematic and 3D view

## License

Private — not open source.
