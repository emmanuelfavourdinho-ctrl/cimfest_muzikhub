import {
  Briefcase,
  Contact,
  Gem,
  Home,
  MessageCircle,
  Mic,
  Plus,
  Search,
  Trophy,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Present only when the feature exists. Items without `to` render as disabled "Coming soon". */
  to?: string;
}

/**
 * Sidebar destinations, in the prototype's order. Areas that are not built yet are listed
 * so the product's shape is visible, but they are disabled and labelled — never dead links.
 * Add `to` when a feature ships.
 */
export const primaryNav: NavItem[] = [
  { label: 'Home', icon: Home, to: '/home' },
  { label: 'Discover', icon: Search, to: '/discover' },
  { label: 'Network', icon: Contact, to: '/network' },
  { label: 'Creator studio', icon: Mic, to: '/studio' },
  { label: 'Communities', icon: UsersRound, to: '/communities' },
  { label: 'Collaborate', icon: Users },
  { label: 'Opportunities', icon: Briefcase, to: '/opportunities' },
  { label: 'Plans', icon: Gem, to: '/pricing' },
  { label: 'Competitions', icon: Trophy },
  { label: 'Messages', icon: MessageCircle, to: '/messages' },
];

/** Mobile bottom bar (prototype: Home, Discover, Create, Activity, Profile). */
export const mobileNav = (username: string | null): (NavItem & { emphasis?: boolean })[] => [
  { label: 'Home', icon: Home, to: '/home' },
  { label: 'Discover', icon: Search, to: '/discover' },
  { label: 'Create', icon: Plus, to: '/studio/new', emphasis: true },
  { label: 'Network', icon: Contact, to: '/network' },
  { label: 'Profile', icon: UserRound, to: username ? `/u/${username}` : '/login' },
];
