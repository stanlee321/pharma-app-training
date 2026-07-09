# View 1: Initial Launch & Modal View

## 1. Purpose
To handle the initial app launch experience and display critical announcements, updates, or subscription information to the user before they access the core app functionalities.

## 2. UI Elements
*   **Background:** The main app interface, blurred or dimmed out.
*   **Modal Container:** Centered popup box.
*   **Header:** Title text (e.g., "Important message").
*   **Body Text:** Scrollable or static text area explaining the announcement (e.g., version updates, platform changes, trial eligibility).
*   **Action Buttons (Vertical Stack):**
    *   `Secondary Button`: "More info" (External link).
    *   `Secondary Button`: "Claim your discount" (External link or deep link).
    *   `Primary Button`: "Continue with [App Name]" (Dismisses modal).
*   **Footer Text:** Small informational text (e.g., "Links also present in info screen").

## 3. Functionalities & User Flow
1.  **App Initialization:** On launch, the app checks for new announcements via an API or local configuration.
2.  **Display Logic:** If a new message exists and hasn't been dismissed previously, the modal renders over the main UI.
3.  **External Routing:** Tapping "More info" or "Claim your discount" opens the device's default web browser.
4.  **Dismissal:** Tapping "Continue" closes the modal, saves the "read" state locally, and grants access to the underlying app.

## 4. Data & State Management
*   `announcementData`: Object containing title, body, and link URLs.
*   `hasSeenAnnouncement`: Boolean stored in local device storage (e.g., AsyncStorage, UserDefaults) to prevent showing the same message on every launch.
