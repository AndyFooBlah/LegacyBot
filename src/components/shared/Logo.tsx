// Copyright 2026 Andrew Brook
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * LegacyBot logo — retro striped sunset with audio waveform.
 * Renders inline SVG so it works without external file loading.
 */

import React from 'react';

interface LogoProps {
  size?: number;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({ size = 32, className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 32 32"
    width={size}
    height={size}
    className={className}
    aria-label="BiographyBot logo"
  >
    <defs>
      <linearGradient id="lb-sun" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f59e0b" />
        <stop offset="50%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#dc2626" />
      </linearGradient>
      <clipPath id="lb-sc"><circle cx="16" cy="18" r="10" /></clipPath>
      <clipPath id="lb-h"><rect x="0" y="0" width="32" height="18" /></clipPath>
    </defs>
    <g clipPath="url(#lb-h)">
      <circle cx="16" cy="18" r="10" fill="url(#lb-sun)" />
      <g clipPath="url(#lb-sc)">
        <rect x="0" y="10" width="32" height="1.5" fill="white" opacity="0.9" />
        <rect x="0" y="13.5" width="32" height="1.5" fill="white" opacity="0.85" />
        <rect x="0" y="16.5" width="32" height="1.5" fill="white" opacity="0.8" />
      </g>
    </g>
    <line x1="3" y1="18" x2="29" y2="18" stroke="#4338ca" strokeWidth="1.5" strokeLinecap="round" />
    <g stroke="#6366f1" strokeWidth="1.5" strokeLinecap="round" opacity="0.7">
      <line x1="7" y1="22" x2="7" y2="25" />
      <line x1="10" y1="21" x2="10" y2="26" />
      <line x1="13" y1="20" x2="13" y2="27" />
      <line x1="16" y1="21" x2="16" y2="26" />
      <line x1="19" y1="20" x2="19" y2="27" />
      <line x1="22" y1="21" x2="22" y2="26" />
      <line x1="25" y1="22" x2="25" y2="25" />
    </g>
  </svg>
);
