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
 * Memoir PDF export service.
 *
 * Generates a professionally formatted PDF from a Memoir using jsPDF.
 * Includes cover page, table of contents, chapter content, and citations.
 */

import { jsPDF } from 'jspdf';
import { Memoir } from '../types';

const PAGE_WIDTH = 210; // A4 mm
const PAGE_HEIGHT = 297;
const MARGIN_LEFT = 25;
const MARGIN_RIGHT = 25;
const MARGIN_TOP = 30;
const MARGIN_BOTTOM = 25;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const LINE_HEIGHT = 7;

/**
 * Export a memoir as a downloadable PDF.
 */
export function exportMemoirAsPdf(memoir: Memoir, storytellerName: string): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  // --- Cover page ---
  renderCoverPage(doc, memoir, storytellerName);

  // --- Table of Contents ---
  doc.addPage();
  renderTableOfContents(doc, memoir);

  // --- Chapters ---
  const chapterPages: number[] = [];
  for (const chapter of memoir.chapters) {
    doc.addPage();
    chapterPages.push(doc.getNumberOfPages());
    renderChapter(doc, chapter.title, chapter.content, chapter.citations);
  }

  // --- Page numbers (skip cover) ---
  const totalPages = doc.getNumberOfPages();
  for (let i = 2; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(9);
    doc.setTextColor(150);
    doc.text(`${i - 1}`, PAGE_WIDTH / 2, PAGE_HEIGHT - 12, { align: 'center' });
  }

  // Download
  const filename = `${storytellerName.replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')}_Memoir.pdf`;
  doc.save(filename);
}

function renderCoverPage(doc: jsPDF, memoir: Memoir, storytellerName: string): void {
  // Background accent
  doc.setFillColor(79, 70, 229); // indigo-600
  doc.rect(0, 0, PAGE_WIDTH, 100, 'F');

  // Title
  doc.setTextColor(255);
  doc.setFontSize(32);
  doc.setFont('helvetica', 'bold');
  const titleLines = doc.splitTextToSize(memoir.title, CONTENT_WIDTH);
  doc.text(titleLines, PAGE_WIDTH / 2, 50, { align: 'center' });

  // Storyteller name
  doc.setFontSize(16);
  doc.setFont('helvetica', 'normal');
  doc.text(storytellerName, PAGE_WIDTH / 2, 80, { align: 'center' });

  // Decorative line
  doc.setDrawColor(79, 70, 229);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_LEFT + 30, 130, PAGE_WIDTH - MARGIN_RIGHT - 30, 130);

  // Chapter count
  doc.setTextColor(100);
  doc.setFontSize(12);
  doc.text(
    `${memoir.chapters.length} Chapter${memoir.chapters.length !== 1 ? 's' : ''}`,
    PAGE_WIDTH / 2,
    145,
    { align: 'center' },
  );

  // Generated info
  doc.setFontSize(9);
  doc.setTextColor(150);
  doc.text(
    `Generated ${new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`,
    PAGE_WIDTH / 2,
    PAGE_HEIGHT - 30,
    { align: 'center' },
  );
  doc.text('Created with BiographyBot', PAGE_WIDTH / 2, PAGE_HEIGHT - 22, { align: 'center' });
}

function renderTableOfContents(doc: jsPDF, memoir: Memoir): void {
  doc.setTextColor(30);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('Table of Contents', MARGIN_LEFT, MARGIN_TOP);

  doc.setDrawColor(200);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_LEFT, MARGIN_TOP + 5, MARGIN_LEFT + 60, MARGIN_TOP + 5);

  let y = MARGIN_TOP + 20;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');

  memoir.chapters.forEach((chapter, i) => {
    doc.setTextColor(60);
    doc.text(`${i + 1}.`, MARGIN_LEFT, y);
    doc.text(chapter.title, MARGIN_LEFT + 10, y);
    y += LINE_HEIGHT + 3;
  });
}

function renderChapter(
  doc: jsPDF,
  title: string,
  content: string,
  citations: { quote: string; sessionId: string }[],
): void {
  let y = MARGIN_TOP;

  // Chapter title
  doc.setTextColor(30);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  const titleLines = doc.splitTextToSize(title, CONTENT_WIDTH);
  doc.text(titleLines, MARGIN_LEFT, y);
  y += titleLines.length * 9 + 8;

  // Decorative line under title
  doc.setDrawColor(79, 70, 229);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_LEFT, y, MARGIN_LEFT + 40, y);
  y += 10;

  // Chapter body
  doc.setTextColor(50);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');

  const paragraphs = content.split(/\n\n+/);
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    const lines = doc.splitTextToSize(trimmed, CONTENT_WIDTH);
    for (const line of lines) {
      if (y > PAGE_HEIGHT - MARGIN_BOTTOM) {
        doc.addPage();
        y = MARGIN_TOP;
      }
      doc.text(line, MARGIN_LEFT, y);
      y += LINE_HEIGHT;
    }
    y += 3; // paragraph spacing
  }

  // Citations
  if (citations.length > 0) {
    y += 8;
    if (y > PAGE_HEIGHT - MARGIN_BOTTOM - 30) {
      doc.addPage();
      y = MARGIN_TOP;
    }

    doc.setDrawColor(200);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_LEFT, y, MARGIN_LEFT + 50, y);
    y += 8;

    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.setFont('helvetica', 'bold');
    doc.text('SOURCE CITATIONS', MARGIN_LEFT, y);
    y += 6;

    doc.setFont('helvetica', 'italic');
    for (let i = 0; i < citations.length; i++) {
      if (y > PAGE_HEIGHT - MARGIN_BOTTOM) {
        doc.addPage();
        y = MARGIN_TOP;
      }
      const quoteText = `[${i + 1}] "${citations[i].quote.slice(0, 120)}..."`;
      const lines = doc.splitTextToSize(quoteText, CONTENT_WIDTH);
      for (const line of lines) {
        doc.text(line, MARGIN_LEFT, y);
        y += 5;
      }
      y += 2;
    }
  }
}
