import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '@/components/chat/ChatInput';

// Mock the initiative store
const mockSendMessage = jest.fn();

jest.mock('@/stores/initiativeStore', () => ({
  useInitiativeStore: () => ({
    sendMessage: mockSendMessage,
  }),
}));

describe('ChatInput', () => {
  const defaultProps = {
    initiativeId: 'test-initiative-id',
    disabled: false,
    stage: 'intake',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders textarea', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders submit button', () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('has correct placeholder for intake stage', () => {
    render(<ChatInput {...defaultProps} stage="intake" />);
    expect(screen.getByPlaceholderText(/describe your initiative/i)).toBeInTheDocument();
  });

  it('has correct placeholder for evidence stage', () => {
    render(<ChatInput {...defaultProps} stage="evidence" />);
    expect(screen.getByPlaceholderText(/upload evidence/i)).toBeInTheDocument();
  });

  it('has correct placeholder for generate stage', () => {
    render(<ChatInput {...defaultProps} stage="generate" />);
    expect(screen.getByPlaceholderText(/click generate/i)).toBeInTheDocument();
  });

  it('allows typing in textarea', async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello world');
    
    expect(textarea).toHaveValue('Hello world');
  });

  it('disables submit button when textarea is empty', () => {
    render(<ChatInput {...defaultProps} />);
    
    const submitButton = screen.getByRole('button');
    expect(submitButton).toBeDisabled();
  });

  it('enables submit button when textarea has content', async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Hello');
    
    const submitButton = screen.getByRole('button');
    expect(submitButton).not.toBeDisabled();
  });

  it('calls sendMessage on form submit', async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Test message');
    
    const submitButton = screen.getByRole('button');
    await user.click(submitButton);
    
    expect(mockSendMessage).toHaveBeenCalledWith('test-initiative-id', 'Test message');
  });

  it('clears input after submit', async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Test message');
    await user.click(screen.getByRole('button'));
    
    await waitFor(() => {
      expect(textarea).toHaveValue('');
    });
  });

  it('submits on Enter key press', async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Test message{enter}');
    
    expect(mockSendMessage).toHaveBeenCalledWith('test-initiative-id', 'Test message');
  });

  it('does not submit on Shift+Enter', async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Test{shift>}{enter}{/shift}message');
    
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(textarea).toHaveValue('Test\nmessage');
  });

  it('is disabled when disabled prop is true', () => {
    render(<ChatInput {...defaultProps} disabled={true} />);
    
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeDisabled();
  });

  it('trims whitespace from message', async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, '  Test message  ');
    await user.click(screen.getByRole('button'));
    
    expect(mockSendMessage).toHaveBeenCalledWith('test-initiative-id', 'Test message');
  });

  it('does not submit empty or whitespace-only messages', async () => {
    const user = userEvent.setup();
    render(<ChatInput {...defaultProps} />);
    
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, '   ');
    
    // Button should still be disabled for whitespace-only
    const submitButton = screen.getByRole('button');
    expect(submitButton).toBeDisabled();
  });
});
