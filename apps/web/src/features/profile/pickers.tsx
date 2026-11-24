import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  CREATIVE_ROLE_KEYS,
  CREATIVE_ROLES,
  GENRE_KEYS,
  GENRES,
  GOAL_KEYS,
  GOALS,
  type CreativeRole,
  type Genre,
  type Goal,
} from '@muzikhub/shared';
import { ToggleChip } from '@/components/ui/primitives';

function toggle<T>(list: T[], value: T, max: number): T[] {
  if (list.includes(value)) return list.filter((v) => v !== value);
  return list.length >= max ? list : [...list, value];
}

interface PickerProps<T> {
  value: T[];
  onChange: (next: T[]) => void;
  max: number;
  label: string;
}

function ChipGroup<T extends string>({ options, labels, value, onChange, max, label }: PickerProps<T> & { options: readonly T[]; labels: Record<T, string> }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((key) => (
        <ToggleChip
          key={key}
          selected={value.includes(key)}
          disabled={!value.includes(key) && value.length >= max}
          onClick={() => onChange(toggle(value, key, max))}
          className="disabled:opacity-40"
        >
          {labels[key]}
        </ToggleChip>
      ))}
    </div>
  );
}

/** Suggested roles first; the full list is one tap away. Multiple roles allowed. */
export function RolePicker({ suggested, ...props }: PickerProps<CreativeRole> & { suggested: CreativeRole[] }) {
  const [showAll, setShowAll] = useState(suggested.length === 0 || props.value.some((r) => !suggested.includes(r)));
  const options = showAll ? CREATIVE_ROLE_KEYS : suggested;
  return (
    <div>
      <ChipGroup options={options} labels={CREATIVE_ROLES} {...props} />
      {!showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="mt-3 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-mint-soft hover:underline">
          Show all roles <ChevronDown className="size-3.5" />
        </button>
      )}
      <p className="mt-2 text-xs text-sage-dim">
        {props.value.length}/{props.max} selected
      </p>
    </div>
  );
}

export function GenrePicker(props: PickerProps<Genre>) {
  return (
    <div>
      <ChipGroup options={GENRE_KEYS} labels={GENRES} {...props} />
      <p className="mt-2 text-xs text-sage-dim">
        {props.value.length}/{props.max} selected
      </p>
    </div>
  );
}

export function GoalPicker(props: PickerProps<Goal>) {
  return <ChipGroup options={GOAL_KEYS} labels={GOALS} {...props} />;
}
