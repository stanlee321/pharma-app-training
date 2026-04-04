Here is the requested Markdown file. You can save this as `07_Video_Timestamps_FFmpeg.md`. 

This document breaks the video down into logical segments that map directly to the functional documents. I have also included the exact `ffmpeg` commands you can copy and paste into your terminal to split the video locally.

---

### File 7: `07_Video_Timestamps_FFmpeg.md`

```markdown
# Video Timestamps & FFmpeg Splitting Guide

This document provides exact timestamps for the different UI views and interactions demonstrated in the reference video. You can use this to split the video into smaller, focused clips for your development and design teams.

## Timeline & Captions

| Start | End | View Reference | Caption / Expected Action in Frame |
| :--- | :--- | :--- | :--- |
| **00:00** | **00:04** | `View 1` | **App Launch & Modal:** Splash screen transitions to the "Important message" modal. User clicks "Continue with TivatrainerX". |
| **00:04** | **00:18** | `View 2` | **Drug & Model Selection:** User scrolls through the bottom picker wheel. The top text dynamically updates. User selects "Dexmedetomidine Hannivoort". |
| **00:18** | **00:21** | `View 3` | **Patient Data Input:** User adjusts the "Dilution" numeric input using the stepper. Shows static biometric fields (Weight, Length, Age, Gender). User clicks "Done". |
| **00:21** | **00:54** | `View 4` | **Target Node Interaction:** Main graph view. User taps to summon the Target Node (blue circle) and drags it up/down the Y-axis. Top readouts (Bolus/Infusion) calculate in real-time. |
| **00:54** | **01:30** | `View 4` | **Graph Simulation & Scrubbing:** User clicks "Done". The simulation starts drawing colored curves over time. User scrubs the vertical time cursor left/right, revealing a tooltip with exact numerical data for that specific second. |
| **01:30** | **02:20** | `View 5` | **Compartmental Animation Sync:** User enters the split-screen view. Top half shows animated cylinders (V1, V2, V3) and particles. User scrubs the bottom graph timeline, and the fluid levels/particles in the top animation update synchronously to match the timeline. |

---

## FFmpeg Commands for Local Splitting

Assuming your source video is named `tiva_app_tour.mp4`, you can run the following commands in your terminal to extract each specific segment without re-encoding (which is super fast and preserves original quality).

**1. Extract App Launch & Modal (00:00 - 00:04)**
```bash
ffmpeg -i tiva_app_tour.mp4 -ss 00:00:00 -to 00:00:04 -c copy 01_Launch_Modal.mp4
```

**2. Extract Drug & Model Selection (00:04 - 00:18)**
```bash
ffmpeg -i tiva_app_tour.mp4 -ss 00:00:04 -to 00:00:18 -c copy 02_Drug_Selection.mp4
```

**3. Extract Patient Data Input (00:18 - 00:21)**
```bash
ffmpeg -i tiva_app_tour.mp4 -ss 00:00:18 -to 00:00:21 -c copy 03_Patient_Data.mp4
```

**4. Extract Target Node Interaction (00:21 - 00:54)**
```bash
ffmpeg -i tiva_app_tour.mp4 -ss 00:00:21 -to 00:00:54 -c copy 04_Target_Node_UI.mp4
```

**5. Extract Graph Simulation & Scrubbing (00:54 - 01:30)**
```bash
ffmpeg -i tiva_app_tour.mp4 -ss 00:00:54 -to 00:01:30 -c copy 05_Graph_Simulation.mp4
```

**6. Extract Compartmental Animation Sync (01:30 - 02:20)**
```bash
ffmpeg -i tiva_app_tour.mp4 -ss 00:01:30 -to 00:02:20 -c copy 06_Compartmental_Animation.mp4
```

*(Note: The video ends at 02:22, but the last 2 seconds are just the iOS control center being pulled down, so 02:20 is the logical end point for the app footage).*
```
