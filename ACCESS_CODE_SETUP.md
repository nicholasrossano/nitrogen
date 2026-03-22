# Access Code Setup

## Current Configuration

The access code is loaded from the `NEXT_PUBLIC_ACCESS_CODE` environment variable. Set it in `frontend/.env.local` (see `frontend/.env.local.example`).

## How It Works

1. User visits the app and sees the access code page
2. They enter the access code
3. Access is stored in localStorage
4. They proceed directly to the app with a mock/shared user
5. All Firebase auth code remains intact but bypassed

## Files

- `frontend/src/components/AccessCodeGate.tsx` - Access code gate component
- `frontend/src/lib/auth.tsx` - Access code bypass logic
- `frontend/src/app/providers.tsx` - Wraps app with AccessCodeGate

## To Change the Access Code

Update the `NEXT_PUBLIC_ACCESS_CODE` environment variable in your `.env.local` file and restart the frontend dev server.

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

## Backend Compatibility

The backend accepts a dev mock token only when `DEBUG=true` and the `DEV_MOCK_TOKEN` environment variable is set. All projects use a shared user ID (`shared-user`).

### Migrating Existing Production Data

If you had projects created with real Firebase authentication, you need to migrate them to the shared user ID:

```bash
cd backend
python -m scripts.migrate_to_shared_user
```

This will:
- Find all initiatives with non-shared user IDs
- Update them to use `user_id="shared-user"`
- Make them visible in shared access code mode

**You only need to run this once** when switching from Firebase to access code mode.

## User Experience

- **Shared Workspace**: All users see the same projects (user_id = "shared-user")
- **No Personal Data**: Everything is collaborative
- **Simple Access Control**: One code for everyone
- **Clean UI**: Matches your existing login page design

## Troubleshooting

**Problem: "Failed to load projects" in production**

This happens when:
1. Frontend and backend are using different user IDs (now fixed to "shared-user")
2. Existing projects have old Firebase user IDs

**Solution:** Run the migration script:
```bash
cd backend
python -m scripts.migrate_to_shared_user
```
