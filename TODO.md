# TIVA/TCI iOS App — Frontend Build Plan

## Phase 0: Foundation
- [x] Documentation: Functional requirements (docs/00–06)
- [x] Documentation: Technical architecture (docs/technical/)
- [x] Documentation: Rust engine spec (docs/rust-engine-spec/)
- [x] Documentation: Video UI analysis (docs/technical/03)
- [x] Data models: SimulationTypes, PatientProfile, DrugModel
- [x] Engine protocol: PKEngineProtocol
- [x] Mock engine: MockPKEngine with RK4 solver (Marsh, Schnider, Minto, Hannivoort)
- [x] Mock data: 5 JSON snapshots (30min simulations, 1s resolution)
- [x] Engine provider: EngineProvider with Mock/Rust toggle
- [x] Rust bridge stub: RustPKEngine placeholder
- [x] Xcode project: Create .xcodeproj (iOS 17+, SwiftUI lifecycle)
- [x] Add all existing Swift files and resources to Xcode target
- [x] Drug database JSON: Bundle drug_models.json in Resources

## Phase 1: Navigation Shell & App State
- [x] PharmaApp.swift: @main entry point with NavigationStack
- [x] AppState: @Observable class (selected drug, patient profile, sim state)
- [x] NavigationRouter: Enum-based routing (modal → drug → patient → sim → compartmental)
- [ ] Dark/light theme switching (light for input screens, dark for simulation)

## Phase 2: Screen 1 — Launch Modal
- [x] LaunchModalView: ZStack with blurred background + modal card
- [x] Modal content: Title, scrollable body, 3 action buttons (vertical stack)
- [x] External links: "More info" / "Claim your discount" → openURL
- [x] Dismissal: "Continue" saves hasSeenAnnouncement to @AppStorage
- [x] Display logic: Only show if announcement not previously dismissed

## Phase 3: Screen 2 — Drug & Model Selection
- [x] DrugSelectionView: Layout with metadata area + picker + bottom toolbar
- [x] DrugSelectionViewModel: Load drug database, track selectedIndex
- [x] Wheel picker: SwiftUI Picker with .wheel style (upgrade to UIViewRepresentable later if needed)
- [x] Metadata area: ScrollView with description, publication links, comments
- [x] Tappable publication URLs: Link component
- [x] "SELECT 1" button: Save selection to AppState, navigate forward
- [x] Bottom toolbar: "Edit Drug List" and "Saved Simulations" buttons (stubs)

## Phase 4: Screen 3 — Patient Data Input
- [x] PatientInputView: Layout matching video reference
- [x] Drug name + preparation recipe display (read-only top section)
- [x] Dilution stepper row (mg/ml)
- [x] AcceleratingRepeatButton: Custom component (tap +1, hold accelerates)
- [x] Weight stepper (Kg)
- [x] Height/Length stepper (cm)
- [x] Age stepper (yr)
- [x] Gender toggle (Male/Female as tappable text)
- [x] Validation: Enforce min/max per selected model's validationRules
- [x] "Done" button: Build PatientProfile, trigger initial engine call, navigate

## Phase 5: Screen 4 — Main Simulation Graph
- [x] SimulationView: Dark theme layout
- [x] SimulationViewModel: Orchestrate engine calls, manage state
- [x] Top toolbar: "Manual" label, drug name, play/pause/speed icons
- [x] Status dashboard: Model name, current concentration display

### Chart (custom SwiftUI Canvas)
- [x] ChartCanvas: Core Canvas view with coordinate system
- [x] Dual Y-axes: Left (concentration), Right (infusion rate)
- [x] X-axis: Time in minutes with grid lines
- [x] Curve rendering: Draw [CurvePoint] arrays as colored Path lines
- [x] Multiple curve support: Cp (plasma), Ce (effect-site), infusion rate
- [x] Time cursor: Vertical blue line, draggable horizontally (DragGesture)
- [x] Data tooltip: Floating box showing values at cursor time position
- [x] Tooltip format: Value + label per curve (e.g., "0.3(Cp)", "0.1(Ke0)")
- [x] Time display: HH:MM:SS format at cursor position

### Target Node Interaction
- [x] Target node: Bright blue circle on cursor line, draggable vertically
- [x] Drag gesture: Clamp to Y-axis concentration range
- [x] Real-time TCI readouts: Bolus (ml, mcg/kg) + Infusion (ml/hr, mcg/kg/hr)
- [x] Engine call on drag: computeTCI() via MockPKEngine, < 16ms
- [x] Nudge buttons: ↑↓ for fine-tuning target by small increments
- [x] Bottom toolbar switch: Default → "Cancel | Done | ↑↓" during drag
- [x] "Done" applies target: Full simulate() call, update curves
- [x] "Cancel" reverts: Discard drag, restore previous state

### Simulation Playback
- [x] Play/Pause: Animate time cursor advancing along X-axis
- [x] Speed control: 1x, 2x, 4x, 8x playback speed
- [x] Scrubbing: Drag time cursor to view historical/predicted values
- [x] Multiple targets: "+ Target" button, markers on chart, remove via minus button

## Phase 6: Screen 5 — Compartmental Animation
- [x] CompartmentalView: Split-screen layout (animation top, mini chart bottom)
- [x] CompartmentalViewModel: Drive animation from simulation output data

### Compartment Visualization (2D Canvas with pseudo-3D)
- [x] V1 cylinder: Central compartment with gradient fluid fill
- [x] V2 cylinder: Rapid peripheral compartment
- [x] V3 cylinder: Slow peripheral compartment
- [x] Effect site: Diamond shape with green fill
- [x] Syringe/IV graphic: Left side, shows active/inactive state
- [x] Clearance graphic: Arrow pipe from V1 downward with particles
- [x] Connecting pipes: Lines between compartments with directional particles
- [x] Fluid level animation: Fill height = amount / max_amount per compartment
- [x] Particle system: Animated dots flowing along pipes at 30fps
- [x] Particle speed: Proportional to rate constants (k12, k21, k13, k31, ke0, k10)

### Toolbar Modes
- [x] "Data" button: Toggle percentage overlay on compartments
- [x] "Sizes" button: Scale cylinders proportional to V1/V2/V3 volumes + show ml labels
- [x] "Labels" button: Toggle compartment name labels (V1, V2, V3, Effect, IV, CL)
- [x] "X" close: Return to simulation view

### Mini Chart (Bottom Half)
- [x] Reuse ChartCanvas in compact mode
- [x] Scrub cursor: Draggable, synced to top animation
- [x] Timeline sync: Cursor position drives compartment fluid levels + particle state

### Future improvements
- [ ] Upgrade to SceneKit 3D cylinders with glass material (matches reference video)
- [ ] "IV assist" button functionality
- [ ] Bidirectional sync: Scrubbing mini chart updates 3D, and vice versa

## Phase 7: UI/UX Improvements (docs/uiux/)

### P0 — Target Interaction
- [x] Default initial target so chart isn't empty on first load
- [x] Onboarding hint when no targets ("Tap chart to set target")
- [x] Larger touch target with 44pt glow ring around node
- [x] Value label pinned to node during drag
- [x] Horizontal dashed target line across chart
- [x] Haptic feedback on round-number snap during drag
- [x] Haptic on Done confirm

### P0 — Compartmental 3D
- [x] SceneKit SCNCylinder with glass material for V1/V2/V3
- [x] Fluid cylinder (inner, height-animated) per compartment
- [x] SCNParticleSystem along pipes (syringe→V1, V1→V2, V1→V3, V1→Effect, V1→CL)
- [x] Lighting setup (ambient + key directional + fill directional + shadows)
- [x] Camera with turntable orbit control (user can rotate/zoom)
- [x] Glass rim torus on cylinder top edges
- [x] Effect site as SCNSphere with emission glow
- [x] Syringe with barrel, plunger rod, needle (animated on infusion)
- [x] Floor with subtle reflections
- [x] Billboard-constrained text labels (always face camera)
- [x] Sizes mode: scale compartments + show volume ml labels
- [x] 2D/3D toggle in toolbar to switch between Canvas and SceneKit
- [x] Smooth SCNTransaction animations (0.25s) on fluid/scale updates

### P1 — Chart Polish
- [x] Infusion rate drawn as filled semi-transparent area (not thin line)
- [x] Infusion rate stroke on top of area (1.5pt orange)
- [x] Inline curve labels ("Cp", "Ce") at right edge of curves
- [x] Minor grid lines between major intervals
- [x] Grid contrast improved (0.12 minor, 0.2 major)
- [x] Right Y-axis labels contrast increased (0.8 opacity)
- [x] Floating tooltip follows cursor (flips side at 50%)

### P1 — Navigation & Discovery
- [x] Segmented control [Graph] [Compartments] in simulation view
- [x] Compartmental view embedded (no separate navigation push needed)
- [x] System-style back button (chevron.left + "Back")
- [x] .preferredColorScheme(.dark) for simulation screen

### P1 — Drug Selection
- [x] Structured metadata cards with section headers
- [x] Rounded card background per section (Description, Publication, Comment)
- [x] SELECT 1 button as blue capsule (more prominent)

### P2 — Patient Input
- [x] Stepper buttons with border and 48pt touch target
- [x] Monospaced bold digits for values
- [x] Numeric content transition animation
- [x] Haptic feedback on stepper taps

### P2 — Design System
- [x] DesignSystem.swift: AppColors, Font extensions, Haptics, Spacing
- [x] Consistent color palette across chart, compartmental, and UI

## Phase 8: Future Work
- [ ] Rust engine integration: Implement RustPKEngine C-FFI calls
- [ ] Flip EngineProvider.useMock to false
- [ ] SceneKit 3D compartmental upgrade (see docs/uiux/02_Compartmental_3D.md)
- [ ] Performance profiling: Verify <16ms TCI, <50ms simulate, 60fps animations
- [ ] Accessibility: VoiceOver labels for chart elements and steppers
- [ ] Saved simulations: Persist to SwiftData (load/save from Screen 2)
- [x] Multiple targets: "+ Target" button, markers on chart, remove via minus button
- [ ] Edge cases: Validation errors, zero target, very long simulations
- [ ] App icon and launch screen
