import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BILLING_PRODUCTS, CATALOGUE_OPTIONS, type AdminCatalogueRow } from '@muzikhub/shared';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { PageLoading } from '@/components/ui/primitives';
import { LoadFailed } from '@/features/auth/guards';
import { formatXaf } from '@/features/billing/ui';
import { errorMessage } from '@/lib/api';
import { adminApi } from './admin-api';
import { AdminHeader, Ago, DataTable, ReasonDialog, Tag, useAdminAction } from './ui';

/**
 * Catalogue prices (administrators). A change adds a new version that applies to new orders
 * only; past orders keep the price they were created with. Every change is audited.
 */
export function PricingAdminPage() {
  const { data, isPending, isError, error, refetch } = useQuery({ queryKey: ['admin', 'catalogue'], queryFn: adminApi.catalogue });
  const [editing, setEditing] = useState<AdminCatalogueRow | null>(null);
  const [price, setPrice] = useState('');
  const act = useAdminAction();
  const parsed = Number(price);
  const valid = Number.isInteger(parsed) && parsed >= 100 && parsed <= 10_000_000;

  return (
    <div>
      <AdminHeader
        title="Pricing"
        description="Prices are whole FCFA. A change applies to new orders only and never alters a past order. Nothing can go on sale until its benefits are built and tested."
      />
      {isPending ? (
        <PageLoading />
      ) : isError ? (
        <LoadFailed message={errorMessage(error)} onRetry={() => void refetch()} />
      ) : (
        <DataTable label="Catalogue">
          <thead>
            <tr>
              <th scope="col">Product</th>
              <th scope="col">Option</th>
              <th scope="col">Price</th>
              <th scope="col">Status</th>
              <th scope="col">Last change</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{BILLING_PRODUCTS[r.product]}</td>
                <td>{CATALOGUE_OPTIONS[r.option].label}</td>
                <td className="tabular-nums">{formatXaf(r.priceXaf)}</td>
                <td>{r.active ? <Tag color="green">On sale</Tag> : <Tag>{r.sellable ? 'Off sale' : 'Not sellable yet'}</Tag>}</td>
                <td className="text-text-2">
                  {r.updatedBy ? (
                    <>
                      {r.updatedBy}, <Ago iso={r.effectiveFrom} />
                      {r.reason && <span className="block text-xs text-text-3">“{r.reason}”</span>}
                    </>
                  ) : (
                    'Initial catalogue'
                  )}
                </td>
                <td className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Change price of ${BILLING_PRODUCTS[r.product]}, ${CATALOGUE_OPTIONS[r.option].label}`}
                    onClick={() => {
                      setPrice(String(r.priceXaf));
                      setEditing(r);
                    }}
                  >
                    Change price
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <ReasonDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `Change price: ${BILLING_PRODUCTS[editing.product]}, ${CATALOGUE_OPTIONS[editing.option].label}` : 'Change price'}
        confirmLabel="Save new price"
        description="Applies to new orders from now on. Orders already started keep their price."
        onConfirm={async (reason) => {
          if (!editing || !valid) return false;
          return act(() => adminApi.changePrice(editing.product, editing.option, parsed, reason), 'Price updated');
        }}
      >
        <Field
          label="New price (FCFA)"
          hint="Whole francs, 100 to 10,000,000."
          error={price && !valid ? 'Enter a whole number from 100 to 10,000,000' : undefined}
        >
          {(f) => <Input {...f} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))} />}
        </Field>
      </ReasonDialog>
    </div>
  );
}
