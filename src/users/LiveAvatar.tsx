import type { CSSProperties } from "react";
import { ProfileAura } from "./ProfileAura";

type Size = "sm" | "md" | "lg" | "xl";

type Props = {
  name: string;
  color: string;
  size?: Size;
  interactive?: boolean;
  className?: string;
  variant?: "plain" | "add";
  title?: string;
  imageUrl?: string | null;
};

const PX: Record<Size, number> = {
  sm: 34,
  md: 52,
  lg: 96,
  xl: 140,
};

/**
 * PP unique = ProfileAura (orbe particules).
 * Variante `add` = pastille “+” pour la gate.
 */
export function LiveAvatar({
  name,
  color,
  size = "md",
  interactive = true,
  className = "",
  variant = "plain",
  title,
  imageUrl = null,
}: Props) {
  const px = PX[size];

  if (variant === "add") {
    return (
      <span
        className={`live-avatar live-avatar--add live-avatar--${size} ${className}`.trim()}
        style={{ width: px, height: px }}
        title={title ?? "Nouveau profil"}
        aria-hidden
      >
        <span className="live-avatar-add-core">+</span>
      </span>
    );
  }

  return (
    <ProfileAura
      name={name}
      color={color}
      size={px}
      compact={size === "sm" || size === "md"}
      interactive={interactive}
      imageUrl={imageUrl}
      className={`live-avatar live-avatar--${size} ${className}`.trim()}
    />
  );
}

/** @deprecated — préférer ProfileAura / LiveAvatar */
export function avatarMark(name: string, size: Size = "md"): string {
  const max = size === "sm" ? 4 : size === "md" ? 5 : 8;
  const raw = name.trim() || "?";
  return raw.length <= max ? raw : `${raw.slice(0, max - 1)}…`;
}

export type { Size as AvatarSize };
export type { CSSProperties };
