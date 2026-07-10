import LocalCustomerDatabasePage from "./LocalCustomerDatabasePage.jsx";
import SupabaseCustomerDatabasePage from "./SupabaseCustomerDatabasePage.jsx";

const USE_SUPABASE_CUSTOMER_DATABASE = String(import.meta.env.VITE_USE_SUPABASE_CUSTOMER_DATABASE || "").toLowerCase() === "true";

export default function CustomerDatabasePage() {
  return USE_SUPABASE_CUSTOMER_DATABASE ? <SupabaseCustomerDatabasePage /> : <LocalCustomerDatabasePage />;
}
