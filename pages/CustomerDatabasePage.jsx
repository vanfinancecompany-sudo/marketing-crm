import LocalCustomerDatabasePage from "./LocalCustomerDatabasePage.jsx";
import SupabaseCustomerDatabasePage from "./SupabaseCustomerDatabasePage.jsx";

const USE_SUPABASE_CUSTOMER_DATABASE = import.meta.env.VITE_USE_SUPABASE_CUSTOMER_DATABASE === "true";

export default function CustomerDatabasePage() {
  return USE_SUPABASE_CUSTOMER_DATABASE ? <SupabaseCustomerDatabasePage /> : <LocalCustomerDatabasePage />;
}
