# Access Code Setup

## Current Configuration

**Access Code:** `nitrogen324`

The app now uses a simple access code gate instead of Firebase authentication in production. This allows you to share a single code with collaborators without requiring them to create accounts.

## How It Works

1. User visits the app and sees the access code page
2. They enter `nitrogen324`
3. Access is stored in localStorage
4. They proceed directly to the app with a mock/shared user
5. All Firebase auth code remains intact but bypassed

## Files Modified

- `frontend/src/components/AccessCodeGate.tsx` - New access code gate component
- `frontend/src/lib/auth.tsx` - Added access code bypass logic
- `frontend/src/app/providers.tsx` - Wrapped app with AccessCodeGate

## To Change the Access Code

Edit this line in `frontend/src/components/AccessCodeGate.tsx`:
```typescript
const ACCESS_CODE = 'nitrogen324';
```

## To Re-enable Full Firebase Auth

When you want to bring back proper user accounts:

1. Remove the `<AccessCodeGate>` wrapper from `frontend/src/app/providers.tsx`:
   ```typescript
   export function Providers({ children }: ProvidersProps) {
     return (
       <AuthProvider>
         {children}
       </AuthProvider>
     );
   }
   ```

2. Delete `frontend/src/components/AccessCodeGate.tsx`

3. Remove the access code bypass checks from `frontend/src/lib/auth.tsx`:
   - Delete the `isAccessCodeBypassEnabled()` function
   - Remove the access code checks from `useEffect`, `signOut`, and `getIdToken`

That's it! Firebase auth will work exactly as before.

## Backend Compatibility

The backend already supports mock users in development mode, so it will accept the `dev-mock-token` from the access code bypass without any changes needed.

## User Experience

- **Shared Workspace**: All users see the same projects (user_id = "dev-user-123")
- **No Personal Data**: Everything is collaborative
- **Simple Access Control**: One code for everyone
- **Clean UI**: Matches your existing login page design
