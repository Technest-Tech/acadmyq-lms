"use client";

import type { LucideIcon } from "lucide-react";

/**
 * A dark-styled device `<select>` shared by the pre-join lobby and the in-call "More" menu. Pure and
 * controlled: the caller owns the device list + active id (from `useMediaDeviceSelect`) and handles
 * the change. Falls back to "{label} {n}" when a device has no label (permission not yet granted).
 */
export function DevicePicker({
  label,
  Icon,
  devices,
  activeId,
  onChange,
}: {
  label: string;
  Icon: LucideIcon;
  devices: MediaDeviceInfo[];
  activeId: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <Icon className="size-4 shrink-0 text-slate-400" />
      <select
        aria-label={label}
        value={activeId}
        onChange={(e) => onChange(e.target.value)}
        disabled={devices.length === 0}
        className="min-w-0 flex-1 bg-transparent text-sm text-slate-200 outline-none disabled:opacity-60 [&>option]:bg-slate-800"
      >
        {devices.length === 0 ? (
          <option value="">{label}</option>
        ) : (
          devices.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))
        )}
      </select>
    </div>
  );
}
