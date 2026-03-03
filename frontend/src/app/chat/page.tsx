'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useChatStore } from '@/stores/chatStore';
import { SideDrawer, SideDrawerHeader, NavItem } from '@/components/ui';
import { PanelLeft, SquarePen } from 'lucide-react';
import { LandingInput } from '@/components/core-chat/LandingInput';
import { ConversationView } from '@/components/core-chat/ConversationView';
import { useAuth } from '@/lib/auth';
import { track } from '@/lib/analytics';

function ChatPageContent() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { phase, sendMessage, reset } = useChatStore();
  const [showSidebar, setShowSidebar] = useState(true);

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
    <div className="min-h-screen h-screen flex flex-col overflow-hidden">
      {/* Shared header row */}
      <div className="flex shrink-0">
        <div className={`overflow-hidden transition-[width] duration-300 ease-in-out bg-white ${showSidebar ? 'w-44 border-r-1 border-accent' : 'w-0'}`}>
          <SideDrawerHeader />
        </div>
        <header className="flex-1 px-4 py-[7px] flex items-center justify-between bg-white">
          <button
            onClick={() => setShowSidebar(p => !p)}
            title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            className={`icon-btn p-1.5 ${showSidebar ? 'text-accent' : 'text-text-tertiary'}`}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
          {phase === 'conversation' && (
            <button
              onClick={reset}
              title="New chat"
              className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary transition-colors duration-150 px-2 py-1.5 rounded-lg hover:bg-surface-subtle"
            >
              <SquarePen className="w-3.5 h-3.5" />
              New chat
            </button>
          )}
        </header>
      </div>
      <div className="divider-accent shrink-0" />

      {/* Content row: sidebar + main */}
      <div className="flex flex-1 min-h-0">
      <div className={`overflow-hidden transition-[width] duration-300 ease-in-out flex-shrink-0 bg-white ${showSidebar ? 'w-44 border-r-1 border-accent' : 'w-0'}`}>
        <SideDrawer
          activeItem="chat"
          onItemSelect={handleNavChange}
          includeHeader={false}
          onSignOut={handleSignOut}
          userEmail={user?.email}
        />
      </div>

      <main className="flex-1 bg-white min-h-0 relative overflow-hidden">
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
