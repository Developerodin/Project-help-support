import {
  AlertTriangle,
  ArrowLeft,
  AudioLines,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Info,
  Layers,
  LayoutGrid,
  LineChart,
  List,
  Lock,
  LogOut,
  Maximize2,
  MessageCircle,
  MessageSquare,
  Mic,
  Minimize2,
  MoreHorizontal,
  PanelRight,
  Paperclip,
  PictureInPicture2,
  Pencil,
  Plus,
  Search,
  Send,
  Square,
  SquarePen,
  SlidersHorizontal,
  Ticket,
  Trash2,
  User,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { isTicketOverdue, PRIORITIES } from '@pms/shared';

const PRIORITY_BY_KEY = Object.fromEntries(
  PRIORITIES.map((level) => [level.toLowerCase(), level]),
);

const PRIORITY_CHIP_CLASS = Object.freeze({
  Urgent: 'chip chip-p1',
  High: 'chip chip-p2',
  Medium: 'chip chip-p3',
  Low: 'chip chip-p4',
});

/** @returns {'Low'|'Medium'|'High'|'Urgent'|null} */
export function normalizePriority(priority) {
  if (priority == null || priority === '') return null;
  const key = String(priority).trim().toLowerCase();
  return PRIORITY_BY_KEY[key] ?? null;
}

/** @type {Record<string, import('lucide-react').LucideIcon>} */
const ICONS = {
  board: LayoutGrid,
  ticket: Ticket,
  chart: LineChart,
  bell: Bell,
  layers: Layers,
  teams: Users,
  user: User,
  sliders: SlidersHorizontal,
  'chev-left': ChevronLeft,
  'chev-right': ChevronRight,
  'sign-out': LogOut,
  plus: Plus,
  search: Search,
  x: X,
  eye: Eye,
  clip: Paperclip,
  download: Download,
  trash: Trash2,
  pencil: Pencil,
  lock: Lock,
  send: Send,
  msg: MessageSquare,
  chat: MessageCircle,
  mic: Mic,
  voice: AudioLines,
  'new-chat': SquarePen,
  stop: Square,
  volume: Volume2,
  'volume-off': VolumeX,
  alert: AlertTriangle,
  info: Info,
  back: ArrowLeft,
  more: MoreHorizontal,
  list: List,
  proj: Layers,
  team: Users,
  maximize: Maximize2,
  minimize: Minimize2,
  'panel-right': PanelRight,
  float: PictureInPicture2,
  copy: Copy,
  check: Check,
};

export default function Icon({
  name,
  size = 16,
  strokeWidth = 1.75,
  className,
  ...props
}) {
  const LucideIcon = ICONS[name];
  if (!LucideIcon) return null;

  return (
    <LucideIcon
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={props['aria-hidden'] ?? props['ariaHidden'] ?? true}
      {...props}
    />
  );
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';
}

export function priorityChipClass(priority) {
  const canonical = normalizePriority(priority);
  return PRIORITY_CHIP_CLASS[canonical] ?? 'chip chip-p3';
}

export function priorityLabel(priority) {
  const canonical = normalizePriority(priority);
  if (canonical) return canonical;
  if (priority == null || priority === '') return '—';
  return String(priority);
}

export function priorityCardClass(priority) {
  const canonical = normalizePriority(priority);
  if (!canonical) return '';
  return `card-priority-${canonical.toLowerCase()}`;
}

export function priorityDataValue(priority) {
  const canonical = normalizePriority(priority);
  return canonical ? canonical.toLowerCase() : 'unknown';
}

export function isOverdue(ticket) {
  return isTicketOverdue(ticket);
}
