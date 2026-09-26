import { Outlet, Route, Routes } from 'react-router-dom';
import { EncounterListView } from './EncounterListView';
import { LoginView } from './LoginView';
import { ChangePasswordView } from './ChangePasswordView';
import { EncounterHubView } from './EncounterHubView';
import { PatientDataScreen } from './PatientDataScreen';
import { PreanestheticView } from './PreanestheticView';
import { MonitoringScreen } from './monitoring/MonitoringScreen';
import { DrugLedgerScreen } from './drugs/DrugLedgerScreen';
import { FluidBalanceScreen } from './fluids/FluidBalanceScreen';
import { RecoveryScreen } from './recovery/RecoveryScreen';
import { NewbornScreen } from './newborn/NewbornScreen';
import { TechniqueScreen } from './technique/TechniqueScreen';
import { LandingRedirect, RequireAuth } from './RequireAuth';
import { paths } from './paths';
import { ReviewExportScreen } from './review/ReviewExportScreen';
import { AdminLayout } from './admin/AdminLayout';
import { AdminCasePage } from './admin/AdminCasePage';
import { AdminCasesPage } from './admin/AdminCasesPage';
import { AdminDocumentsPage } from './admin/AdminDocumentsPage';
import { AdminDashboardPage } from './admin/AdminDashboardPage';
import { AdminNewUserPage } from './admin/AdminNewUserPage';
import { AdminUserPage } from './admin/AdminUserPage';
import { AdminUsersPage } from './admin/AdminUsersPage';

/**
 * Route table (Swift RootView `destination(for:)`) with auth + role gates:
 * - /login, /change-password (forced while a password change is pending, else voluntary);
 * - /cases/** — anesthesiologists only (an admin is sent to /admin);
 * - /admin/** — admins only (an anesthesiologist is sent to /cases);
 * - anything else → the signed-in role's landing, or /login.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path={paths.login} element={<LoginView />} />
      <Route
        path={paths.changePassword}
        element={
          <RequireAuth allowPendingPasswordChange>
            <ChangePasswordView />
          </RequireAuth>
        }
      />

      <Route
        path="/cases"
        element={
          <RequireAuth role="anesthesiologist">
            <Outlet />
          </RequireAuth>
        }
      >
        <Route index element={<EncounterListView />} />
        <Route path=":id" element={<EncounterHubView />} />
        <Route path=":id/patient" element={<PatientDataScreen />} />
        <Route path=":id/preanesthetic" element={<PreanestheticView />} />
        <Route path=":id/technique" element={<TechniqueScreen />} />
        <Route path=":id/technique/:zone" element={<TechniqueScreen />} />
        <Route path=":id/monitoring" element={<MonitoringScreen />} />
        <Route path=":id/drugs" element={<DrugLedgerScreen />} />
        <Route path=":id/fluids" element={<FluidBalanceScreen />} />
        <Route path=":id/recovery" element={<RecoveryScreen />} />
        <Route path=":id/newborn" element={<NewbornScreen />} />
        <Route path=":id/review" element={<ReviewExportScreen />} />
      </Route>

      <Route
        path="/admin"
        element={
          <RequireAuth role="admin">
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<AdminDashboardPage />} />
        <Route path="cases" element={<AdminCasesPage />} />
        <Route path="cases/:id/*" element={<AdminCasePage />} />
        <Route path="users" element={<AdminUsersPage />} />
        <Route path="users/new" element={<AdminNewUserPage />} />
        <Route path="users/:id" element={<AdminUserPage />} />
        <Route path="documents" element={<AdminDocumentsPage />} />
      </Route>

      <Route path="*" element={<LandingRedirect />} />
    </Routes>
  );
}
