import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInput } from '@/components/chat/ChatInput';

describe('ChatInput', () => {
  const initiativeId = 'init-test-id';

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('renders a textarea', () => {
    render(<ChatInput initiativeId={initiativeId} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('uses correct placeholder for intake stage', () => {
    render(<ChatInput initiativeId={initiativeId} stage="intake" />);
    expect(screen.getByPlaceholderText('Describe your initiative...')).toBeInTheDocument();
  });

  it('uses correct placeholder for evidence stage', () => {
    render(<ChatInput initiativeId={initiativeId} stage="evidence" />);
    expect(screen.getByPlaceholderText('Upload documents above or ask a question...')).toBeInTheDocument();
  });

  it('uses custom placeholder when provided', () => {
    render(<ChatInput initiativeId={initiativeId} placeholder="Type here..." />);
    expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument();
  });

  it('textarea is disabled when disabled prop is true', () => {
    render(<ChatInput initiativeId={initiativeId} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('calls onSend when form is submitted with text', () => {
    const onSend = jest.fn();
    render(<ChatInput initiativeId={initiativeId} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Hello world' } });
    fireEvent.submit(textarea.closest('form')!);
    expect(onSend).toHaveBeenCalledWith('Hello world', null, null);
  });

  it('does not call a legacy store fallback when onSend is missing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    render(<ChatInput initiativeId={initiativeId} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Test message' } });
    fireEvent.submit(textarea.closest('form')!);
    expect(warnSpy).toHaveBeenCalledWith('[ChatInput] Ignoring submit without onSend callback');
  });

  it('clears input after submit', () => {
    const onSend = jest.fn();
    render(<ChatInput initiativeId={initiativeId} onSend={onSend} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Hello' } });
    fireEvent.submit(textarea.closest('form')!);
    expect(textarea).toHaveValue('');
  });

  it('does not submit when input is empty', async () => {
    const onSend = jest.fn();
    render(<ChatInput initiativeId={initiativeId} onSend={onSend} />);
    fireEvent.submit(screen.getByRole('textbox').closest('form')!);
    expect(onSend).not.toHaveBeenCalled();
  });
});
