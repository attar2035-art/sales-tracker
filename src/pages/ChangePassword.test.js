import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock the auth lib so the component doesn't pull in the Supabase client.
jest.mock('../lib/auth', () => ({
  updatePassword: jest.fn().mockResolvedValue({ error: null }),
}));

import ChangePassword from './ChangePassword';
import { updatePassword } from '../lib/auth';

const typePasswords = (container, pw, confirm) => {
  const inputs = container.querySelectorAll('input');
  fireEvent.change(inputs[0], { target: { value: pw } });
  fireEvent.change(inputs[1], { target: { value: confirm } });
  fireEvent.click(screen.getByText(/حفظ كلمة السر/));
};

describe('ChangePassword validation (BUG-034)', () => {
  beforeEach(() => {
    updatePassword.mockReset();
    updatePassword.mockResolvedValue({ error: null });
  });

  it('rejects mismatched passwords', () => {
    const { container } = render(<ChangePassword />);
    typePasswords(container, 'abcd1234', 'different1');
    expect(screen.getByText('كلمتا السر غير متطابقتين')).toBeInTheDocument();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('rejects a password shorter than 8 chars', () => {
    const { container } = render(<ChangePassword />);
    typePasswords(container, 'ab12', 'ab12');
    expect(screen.getByText(/8 أحرف على الأقل/)).toBeInTheDocument();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('rejects a password with no digit', () => {
    const { container } = render(<ChangePassword />);
    typePasswords(container, 'abcdefgh', 'abcdefgh');
    expect(screen.getByText(/حرف ورقم/)).toBeInTheDocument();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('accepts a valid strong password and calls updatePassword', async () => {
    const { container } = render(<ChangePassword />);
    typePasswords(container, 'abcd1234', 'abcd1234');
    expect(updatePassword).toHaveBeenCalledWith('abcd1234');
    // Await the async success state so the update is flushed inside act().
    expect(await screen.findByText('✓ تم تغيير كلمة السر بنجاح')).toBeInTheDocument();
  });
});
