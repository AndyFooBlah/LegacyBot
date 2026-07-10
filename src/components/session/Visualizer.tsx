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
 * Visualizer — animated waveform showing live audio activity.
 *
 * Displays a visual indicator of the session state:
 *   - Flat line when disconnected (idle)
 *   - Green wave when the Storyteller is speaking (user audio active)
 *   - Purple wave with higher amplitude when the bot is speaking
 *
 * This provides important non-verbal feedback to the Storyteller —
 * they can see the bot is "listening" even during silence.
 *
 * References: product_requirements.md §4 (Feedback) | (migrated from components/Visualizer.tsx)
 */

import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  isActive: boolean;
  isBotSpeaking: boolean;
}

export const Visualizer: React.FC<VisualizerProps> = ({ isActive, isBotSpeaking }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrame: number;
    let offset = 0;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!isActive) {
        // Flat line when not connected
        ctx.beginPath();
        ctx.moveTo(0, canvas.height / 2);
        ctx.lineTo(canvas.width, canvas.height / 2);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.stroke();
        return;
      }

      // Animated wave — higher amplitude and purple when bot is speaking
      const amplitude = isBotSpeaking ? 40 : 20;
      const color = isBotSpeaking ? '#6366f1' : '#10b981';

      ctx.beginPath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';

      for (let x = 0; x < canvas.width; x++) {
        const y =
          canvas.height / 2 +
          Math.sin(x * 0.05 + offset) * amplitude * Math.sin(x * 0.01);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.stroke();
      offset += 0.1;
      animationFrame = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationFrame);
  }, [isActive, isBotSpeaking]);

  return (
    <div className="w-full h-32 flex items-center justify-center bg-white rounded-2xl shadow-inner border border-slate-100 overflow-hidden">
      <canvas
        ref={canvasRef}
        width={600}
        height={128}
        className="w-full h-full opacity-80"
      />
    </div>
  );
};
