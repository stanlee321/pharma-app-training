# View 3: Patient Data Input Screen

## 1. Purpose
To collect the patient's biometric data, which is strictly required by the selected PK/PD mathematical model to calculate accurate dosages and distribution curves.

## 2. UI Elements
*   **Top Header:**
    *   Left Action Button: "< Select Drug 1" (Back navigation).
    *   Right Action Button: "Done" (Proceeds to simulation).
*   **Drug Configuration Section:**
    *   Static text displaying the selected drug and model.
    *   **Dilution Input:** Numeric display with `[-]` and `[+]` stepper buttons (units: mg/ml).
*   **Patient Data Section:**
    *   **Weight:** Numeric display with `[-]` and `[+]` stepper buttons (units: Kg).
    *   **Length (Height):** Numeric display with `[-]` and `[+]` stepper buttons (units: cm).
    *   **Age:** Numeric display with `[-]` and `[+]` stepper buttons (units: yr).
    *   **Gender:** Toggle button (e.g., toggles between "Male" and "Female").

## 3. Functionalities & User Flow
1.  **Data Adjustment:** Users tap `[-]` or `[+]` to adjust values. Long-pressing should ideally accelerate the increment/decrement speed.
2.  **Validation:** The app must enforce min/max limits based on the selected mathematical model (e.g., a specific model might only be valid for ages 20-70 or weights 50-110kg).
3.  **Confirmation:** Tapping "Done" saves the patient profile to the global state, triggers the initial math engine calculations, and navigates to the Main Simulation view.

## 4. Data & State Management
*   `patientProfile`: Object `{ weight: int, height: int, age: int, gender: string, dilution: float }`.
*   `validationRules`: Object defining min/max bounds based on the selected model.
