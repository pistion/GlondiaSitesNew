// icons.jsx — inline SVG icon components (lightweight lucide-style)
import React from "react";

const I =
  (paths, opts = {}) =>
  ({ size = 16, stroke = 2, ...rest } = {}) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...rest.style }}
      {...rest}
    >
      {paths}
    </svg>
  );

export const ICN = {
  Home: I(
    <>
      <path d="M3 9.5 12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </>,
  ),
  MessageSquare: I(
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </>,
  ),
  LayoutDashboard: I(
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>,
  ),
  Folder: I(
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>,
  ),
  FolderPlus: I(
    <>
      <path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 11v6M9 14h6" />
    </>,
  ),
  Upload: I(
    <>
      <path d="M12 3v12M7 8l5-5 5 5" />
      <path d="M5 21h14a2 2 0 0 0 2-2v-4M3 15v4a2 2 0 0 0 2 2" />
    </>,
  ),
  Video: I(
    <>
      <rect x="3" y="5" width="13" height="14" rx="2" />
      <path d="m16 10 5-3v10l-5-3z" />
    </>,
  ),
  Music: I(
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>,
  ),
  Download: I(
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </>,
  ),
  Server: I(
    <>
      <rect x="3" y="4" width="18" height="6" rx="1" />
      <rect x="3" y="14" width="18" height="6" rx="1" />
      <circle cx="7" cy="7" r=".5" fill="currentColor" />
      <circle cx="7" cy="17" r=".5" fill="currentColor" />
    </>,
  ),
  Globe: I(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>,
  ),
  Network: I(
    <>
      <rect x="9" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="15" width="6" height="6" rx="1" />
      <rect x="15" y="15" width="6" height="6" rx="1" />
      <path d="M12 9v3M12 12H6v3M12 12h6v3" />
    </>,
  ),
  Layers: I(
    <>
      <path d="m12 2 9 5-9 5-9-5z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </>,
  ),
  Settings: I(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>,
  ),
  CreditCard: I(
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </>,
  ),
  User: I(
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>,
  ),
  Search: I(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
  ),
  Plus: I(
    <>
      <path d="M12 5v14M5 12h14" />
    </>,
  ),
  Minus: I(
    <>
      <path d="M5 12h14" />
    </>,
  ),
  Check: I(
    <>
      <path d="M20 6 9 17l-5-5" />
    </>,
  ),
  ArrowRight: I(
    <>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </>,
  ),
  ArrowLeft: I(
    <>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </>,
  ),
  Chevron: I(
    <>
      <path d="m9 6 6 6-6 6" />
    </>,
  ),
  ChevronDown: I(
    <>
      <path d="m6 9 6 6 6-6" />
    </>,
  ),
  ExternalLink: I(
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </>,
  ),
  Github: I(
    <>
      <path
        d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5a3 3 0 0 0-.85-2.4 8.5 8.5 0 0 0 2-6 6.5 6.5 0 0 0-1.2-3.6 5.7 5.7 0 0 0-.1-3.6S13.7 1 11 3a13 13 0 0 0-6 0c-2.7-2-3.85-1.1-3.85-1.1A5.7 5.7 0 0 0 1 5.5a6.5 6.5 0 0 0-1.2 3.6 8.5 8.5 0 0 0 2 6 3 3 0 0 0-.85 2.4V21"
        transform="translate(2 0)"
      />
    </>,
  ),
  Git: I(
    <>
      <circle cx="12" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M12 8v10M12 13l-3 5M12 13l3 5" />
    </>,
  ),
  Rocket: I(
    <>
      <path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.9.7-2.3 0-3.1a2.2 2.2 0 0 0-3.1.1z" />
      <path d="M12 15c-3-3-3-7 2-12 5 0 5 5 5 5 5 5 1 5-2 8z" />
      <path d="M9 12H4s.5-2.8 2-4 5-1 5-1" />
      <path d="M12 15v5s2.8-.5 4-2 1-5 1-5" />
    </>,
  ),
  ShieldCheck: I(
    <>
      <path d="M12 2 4 5v7c0 5 4 8 8 10 4-2 8-5 8-10V5z" />
      <path d="m9 12 2 2 4-4" />
    </>,
  ),
  Sparkles: I(
    <>
      <path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7zM5 17l.7 1.8L7.5 19.5l-1.8.7L5 22l-.7-1.8L2.5 19.5l1.8-.7zm14-1 .8 2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
    </>,
  ),
  Terminal: I(
    <>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </>,
  ),
  Activity: I(
    <>
      <path d="M22 12h-4l-3 9-6-18-3 9H2" />
    </>,
  ),
  ChartBar: I(
    <>
      <path d="M3 3v18h18" />
      <rect x="7" y="12" width="3" height="6" />
      <rect x="12" y="8" width="3" height="10" />
      <rect x="17" y="4" width="3" height="14" />
    </>,
  ),
  Box: I(
    <>
      <path d="m21 7-9-4-9 4 9 4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </>,
  ),
  Cloud: I(
    <>
      <path d="M17 18a4 4 0 0 0 0-8 6 6 0 0 0-11.6 1.5A4 4 0 0 0 6 18z" />
    </>,
  ),
  Cube: I(
    <>
      <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </>,
  ),
  Trash: I(
    <>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </>,
  ),
  Edit: I(
    <>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4z" />
    </>,
  ),
  Copy: I(
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>,
  ),
  Scissors: I(
    <>
      <circle cx="6" cy="7" r="3" />
      <circle cx="6" cy="17" r="3" />
      <path d="m8.7 8.3 11.8 6.2M8.7 15.7 20.5 9.5" />
    </>,
  ),
  Eye: I(
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </>,
  ),
  EyeOff: I(
    <>
      <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.8 10.8 0 0 1 12 4c7 0 11 8 11 8a18 18 0 0 1-2.1 3.2M6.6 6.6C3.1 8.7 1 12 1 12s4 8 11 8a10.6 10.6 0 0 0 5.4-1.5" />
    </>,
  ),
  Key: I(
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M15 8l3 3M17 6l2 2" />
    </>,
  ),
  Bell: I(
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </>,
  ),
  Briefcase: I(
    <>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </>,
  ),
  Cart: I(
    <>
      <circle cx="9" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
      <path d="M2 3h2l2 13h13l3-8H6" />
    </>,
  ),
  Star: I(
    <>
      <path d="m12 2 3 7 7.5.6L17 15l1.7 7.4L12 18.7 5.3 22.4 7 15 1.5 9.6 9 9z" />
    </>,
  ),
  HelpCircle: I(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a3 3 0 0 1 5.5 1.5c0 1.5-2 2-2.5 3.5M12 17h.01" />
    </>,
  ),
  AlertCircle: I(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </>,
  ),
  CheckCircle: I(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>,
  ),
  Info: I(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>,
  ),
  Tag: I(
    <>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10z" />
      <circle cx="8" cy="8" r="1.5" />
    </>,
  ),
  Power: I(
    <>
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.8 0" />
    </>,
  ),
  Code: I(
    <>
      <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
    </>,
  ),
  Mail: I(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>,
  ),
  Inbox: I(
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>,
  ),
  Send: I(
    <>
      <path d="m22 2-7 20-4-9-9-4z" />
      <path d="M22 2 11 13" />
    </>,
  ),
  Paperclip: I(
    <>
      <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 1 1-2.8-2.8l8.9-8.9" />
    </>,
  ),
  File: I(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </>,
  ),
  Archive: I(
    <>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4" />
    </>,
  ),
  Phone: I(
    <>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L7.9 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6A2 2 0 0 1 22 16.9z" />
    </>,
  ),
  MapPin: I(
    <>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </>,
  ),
  Sun: I(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.4 1.4M17.66 17.66l1.4 1.4M2 12h2M20 12h2M4.93 19.07l1.4-1.4M17.66 6.34l1.4-1.4" />
    </>,
  ),
  Moon: I(
    <>
      <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
    </>,
  ),
  X: I(
    <>
      <path d="M18 6 6 18M6 6l12 12" />
    </>,
  ),
  Menu: I(
    <>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </>,
  ),
  Refresh: I(
    <>
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5M3 21v-5h5" />
    </>,
  ),
  Filter: I(
    <>
      <path d="M3 4h18l-7 9v6l-4 2v-8z" />
    </>,
  ),
  Clock: I(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  ),
  Zap: I(
    <>
      <path d="m13 2-9 12h7l-1 8 9-12h-7z" />
    </>,
  ),
  Database: I(
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>,
  ),
  Building: I(
    <>
      <rect x="4" y="2" width="16" height="20" rx="1" />
      <path d="M9 22V12h6v10M9 6h.01M14.5 6h.01M9 9h.01M14.5 9h.01" />
    </>,
  ),
  Camera: I(
    <>
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </>,
  ),
  Image: I(
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </>,
  ),
  Newspaper: I(
    <>
      <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
      <path d="M18 14h-8M15 18h-5M10 6h8v4h-8z" />
    </>,
  ),
  Mic: I(
    <>
      <rect x="9" y="2" width="6" height="13" rx="3" />
      <path d="M19 11a7 7 0 0 1-14 0M12 18v4" />
    </>,
  ),
  Calendar: I(
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>,
  ),
  Heart: I(
    <>
      <path d="M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" />
    </>,
  ),
  // Social icons (use fill instead of stroke for brand accuracy)
  LinkedIn: ({ size = 16, ...rest } = {}) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={{ flexShrink: 0, ...rest?.style }}
      {...rest}
    >
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77A1.75 1.75 0 0 0 0 1.73v20.54A1.75 1.75 0 0 0 1.77 24h20.45A1.76 1.76 0 0 0 24 22.27V1.73A1.76 1.76 0 0 0 22.22 0Z" />
    </svg>
  ),
  BarChart2: I(
    <>
      <path d="M18 20V10M12 20V4M6 20v-6" />
    </>,
  ),
  Lightbulb: I(
    <>
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.7-1.5 5-3.7 6.3l-.3.2v1.5H9v-1.5l-.3-.2C6.5 14 5 11.7 5 9a7 7 0 0 1 7-7z" />
    </>,
  ),
  Target: I(
    <>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </>,
  ),
  Users: I(
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>,
  ),
  Cpu: I(
    <>
      <rect x="2" y="8" width="20" height="8" rx="2" />
      <path d="M6 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2M6 16v2a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2M2 13h2M20 13h2M8 13h.01M12 13h.01M16 13h.01" />
    </>,
  ),
  RefreshCw: I(
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 7v5h5M16 17h5v-5" />
    </>,
  ),
  Play: I(
    <>
      <polygon points="5 3 19 12 5 21 5 3" />
    </>,
  ),
  Square: I(
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </>,
  ),
  Trash2: I(
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </>,
  ),
  Wand2: I(
    <>
      <path d="m15 4-1 1M4 15l-1 1M19 9l1-1M9 19l1-1M14.5 9.5 5 19l1 1 9.5-9.5m3-4.5-1-1-9.5 9.5 1 1" />
      <path d="M9.5 14.5 5 19M14.5 9.5l1-1" />
    </>,
  ),
};
