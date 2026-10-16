/**
 * @file Reusable super-admin organization selector for payment and campaign forms. Defer
 * free-text search to keep typing responsive, query backend-filtered options and keep the
 * chosen organization controlled by the parent form rather than copying directory state.
 */

import { useDeferredValue, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPlatformOrgs } from "@/lib/api";

/**
 * Provide a labeled search plus organization select populated by the platform API; changing
 * the selection updates the parent's organization ID.
 */
export function OrganizationPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const deferred = useDeferredValue(search);
  const [selectedName, setSelectedName] = useState("");
  const query = useQuery({
    queryKey: ["platform", "org-options", deferred],
    /**
     * Fetch a bounded first page for the deferred search term, so selecting a tenant does not
     * download the entire organization directory.
     */
    queryFn: () => getPlatformOrgs("page_size=30&search=" + encodeURIComponent(deferred)),
  });
  return (
    <div className="admin-field wide">
      <label htmlFor="org-search">Organization</label>
      <input
        id="org-search"
        type="search"
        aria-label="Find an organization"
        placeholder="Search by organization name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        aria-label="Organization"
        required
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setSelectedName(query.data?.items.find((o) => o.id === e.target.value)?.name || "");
        }}
      >
        <option value="">
          {query.isPending ? "Loading organizations..." : "Select an organization"}
        </option>
        {value && !query.data?.items.some((o) => o.id === value) && (
          <option value={value}>{selectedName || "Selected organization"}</option>
        )}
        {query.data?.items.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
      {query.error && (
        <span role="alert" className="text-red-700">
          {query.error.message}
        </span>
      )}
    </div>
  );
}
