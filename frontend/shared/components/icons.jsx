import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Layers,
  LayoutGrid,
  LineChart,
  List,
  Lock,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Send,
  SlidersHorizontal,
  Ticket,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';

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
  x: X,
  eye: Eye,
  clip: Paperclip,
  download: Download,
  trash: Trash2,
  pencil: Pencil,
  lock: Lock,
  send: Send,
  msg: MessageSquare,
  alert: AlertTriangle,
  back: ArrowLeft,
  more: MoreHorizontal,
  list: List,
  proj: Layers,
  team: Users,
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
  if (priority === 'Urgent') return 'chip chip-p1';
  if (priority === 'high') return 'chip chip-p2';
  return 'chip chip-p3';
}

export function priorityLabel(priority) {
  if (priority === 'Urgent') return 'P1';
  if (priority === 'high') return 'P2';
  if (priority === 'medium') return 'P3';
  if (priority === 'low') return 'P4';
  return priority || '—';
}

export function isOverdue(ticket) {
  if (!ticket?.estimatedResolutionAt) return false;
  if (ticket.status === 'closed' || ticket.status === 'live') return false;
  return new Date(ticket.estimatedResolutionAt).getTime() < Date.now();
}
