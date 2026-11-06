import type { FieldSpec } from "@/components/dashboard/api-form";
import { currencyDigits } from "@/lib/money";
import type { ServiceDto } from "@/modules/listings";

/** The service form, shared by "new service" and "edit service". */
export function serviceFields(currency: string, s?: ServiceDto): FieldSpec[] {
  return [
    { name: "name", label: "Name", type: "text", required: true, minLength: 2, maxLength: 120, defaultValue: s?.name, span: 3 },
    { name: "durationMinutes", label: "Duration (minutes)", type: "number", required: true, min: 5, max: 1440, step: 5, defaultValue: s?.durationMinutes ?? 60, span: 3 },
    { name: "priceMinor", label: "Price", type: "money", required: true, currency, digits: currencyDigits(currency), defaultValue: s?.price.amountMinor, span: 2 },
    {
      name: "pricing",
      label: "Price applies",
      type: "select",
      required: true,
      options: [
        { value: "per_booking", label: "Per booking" },
        { value: "per_participant", label: "Per person" },
      ],
      defaultValue: s?.pricing ?? "per_booking",
      span: 2,
    },
    { name: "cancellationWindowHours", label: "Free cancellation (hours before)", type: "number", required: true, min: 0, max: 720, defaultValue: s?.cancellationWindowHours ?? 24, span: 2 },
    { name: "capacity", label: "Places per time slot", type: "number", required: true, min: 1, max: 1000, defaultValue: s?.capacity ?? 1, span: 3, hint: "1 for one-to-one appointments." },
    { name: "maxPerBooking", label: "Most places in one booking", type: "number", required: true, min: 1, max: 1000, defaultValue: s?.maxPerBooking ?? 1, span: 3 },
    { name: "requiresApproval", label: "I approve each booking myself", type: "checkbox", defaultValue: s?.requiresApproval ?? false, hint: "Cards are authorized at booking and charged when you approve." },
    { name: "description", label: "Description", type: "textarea", maxLength: 2000, rows: 3, defaultValue: s?.description },
  ];
}
