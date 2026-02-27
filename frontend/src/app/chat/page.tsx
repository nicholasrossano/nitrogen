'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useChatStore } from '@/stores/chatStore';
import { SideDrawer, NavItem } from '@/components/ui';
import { LandingInput } from '@/components/compliance-chat/LandingInput';
import { ConversationView } from '@/components/compliance-chat/ConversationView';
import { useAuth } from '@/lib/auth';
import { track } from '@/lib/analytics';

function ChatPageContent() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { phase, sendMessage, reset } = useChatStore();

  useEffect(() => {
    track('chat_page_viewed');
  }, []);

  const handleNavChange = (item: NavItem) => {
    if (item === 'chat') {
      reset();
    } else if (item === 'projects' || item === 'trash') {
      router.push('/');
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  return (
    <div className="min-h-screen h-screen flex">
      {/* Self-contained sidebar: Account header (with bottom border) + nav */}
      <SideDrawer
        activeItem="chat"
        onItemSelect={handleNavChange}
        includeHeader
        headerBottomBorder
        onSignOut={handleSignOut}
        userEmail={user?.email}
      />

      <main className="flex-1 bg-white min-h-0 relative">
          {/* Landing state */}
          <div
            className={`absolute inset-0 flex transition-all duration-300 ease-out ${
              phase === 'conversation'
                ? 'opacity-0 pointer-events-none -translate-y-4'
                : 'opacity-100 translate-y-0'
            }`}
          >
            <LandingInput onSend={sendMessage} />
          </div>

          {/* Conversation state */}
          <div
            className={`absolute inset-0 flex flex-col transition-all duration-300 ease-out ${
              phase === 'landing'
                ? 'opacity-0 pointer-events-none translate-y-4'
                : 'opacity-100 translate-y-0'
            }`}
          >
            <ConversationView />
          </div>
      </main>
    </div>
  );
}

export default function ChatPage() {
  return (
    <ProtectedRoute>
      <ChatPageContent />
    </ProtectedRoute>
  );
}
