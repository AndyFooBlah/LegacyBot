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
 * Tests for the QuestionDashboard component.
 *
 * Verifies progress display, status counts, findings, and empty state.
 *
 * References: design.md §5.3 (Priority 2) | src/components/history/QuestionDashboard.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuestionDashboard } from '../../../components/history/QuestionDashboard';
import { InterviewQuestion } from '../../../types';

function makeQuestion(
  status: 'Unasked' | 'InProgress' | 'Completed',
  text: string,
  findings = '',
): InterviewQuestion {
  return {
    id: Math.random().toString(36).slice(2),
    text,
    status,
    findings,
    order: 0,
    createdAt: { toDate: () => new Date() } as any,
    updatedAt: { toDate: () => new Date() } as any,
  };
}

describe('QuestionDashboard', () => {
  it('shows empty state when no questions', () => {
    render(<QuestionDashboard questions={[]} />);

    expect(screen.getByText(/No questions in the Story Queue/i)).toBeInTheDocument();
  });

  it('shows correct progress count', () => {
    const questions = [
      makeQuestion('Completed', 'Q1'),
      makeQuestion('InProgress', 'Q2'),
      makeQuestion('Unasked', 'Q3'),
    ];

    render(<QuestionDashboard questions={questions} />);

    expect(screen.getByText('1/3 completed')).toBeInTheDocument();
  });

  it('shows all status category counts', () => {
    const questions = [
      makeQuestion('Completed', 'Q1'),
      makeQuestion('Completed', 'Q2'),
      makeQuestion('InProgress', 'Q3'),
      makeQuestion('Unasked', 'Q4'),
      makeQuestion('Unasked', 'Q5'),
      makeQuestion('Unasked', 'Q6'),
    ];

    render(<QuestionDashboard questions={questions} />);

    expect(screen.getByText('2 Completed')).toBeInTheDocument();
    expect(screen.getByText('1 In Progress')).toBeInTheDocument();
    expect(screen.getByText('3 Unasked')).toBeInTheDocument();
  });

  it('displays question text', () => {
    const questions = [
      makeQuestion('Unasked', 'Tell me about your childhood.'),
    ];

    render(<QuestionDashboard questions={questions} />);

    expect(screen.getByText('Tell me about your childhood.')).toBeInTheDocument();
  });

  it('displays findings when present', () => {
    const questions = [
      makeQuestion('InProgress', 'First job?', 'Worked at a bakery in 1958.'),
    ];

    render(<QuestionDashboard questions={questions} />);

    expect(screen.getByText('Worked at a bakery in 1958.')).toBeInTheDocument();
  });

  it('does not show findings section for questions with no findings', () => {
    const questions = [makeQuestion('Unasked', 'Q1', '')];

    render(<QuestionDashboard questions={questions} />);

    // The findings section should not render for empty findings
    expect(screen.queryByText(/Finding/)).not.toBeInTheDocument();
  });

  it('handles 100% completion', () => {
    const questions = [
      makeQuestion('Completed', 'Q1'),
      makeQuestion('Completed', 'Q2'),
    ];

    render(<QuestionDashboard questions={questions} />);

    expect(screen.getByText('2/2 completed')).toBeInTheDocument();
  });

  it('shows empty text placeholder for questions with no text', () => {
    const questions = [makeQuestion('Unasked', '')];

    render(<QuestionDashboard questions={questions} />);

    expect(screen.getByText('(empty question)')).toBeInTheDocument();
  });
});
