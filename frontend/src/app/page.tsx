'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ArrowRight, MessageSquare, FileText, Library } from 'lucide-react';
import { api } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleNewInitiative = async () => {
    setLoading(true);
    try {
      const initiative = await api.createInitiative();
      router.push(`/initiatives/${initiative.id}`);
    } catch (error) {
      console.error('Failed to create initiative:', error);
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-full flex-col items-center justify-center p-8 bg-white">
      <div className="max-w-2xl mx-auto text-center">
        {/* Logo/Title - Clean enterprise style */}
        <div className="mb-10">
          <h1 className="text-4xl font-display font-semibold text-text-primary mb-2 tracking-tight">
            Nitrogen
          </h1>
          <p className="text-base text-text-secondary font-medium">
            Decision Packet Studio
          </p>
        </div>

        {/* Description */}
        <p className="text-text-secondary mb-10 max-w-lg mx-auto leading-relaxed">
          Generate investment memos grounded in evidence through conversational AI. 
          Tell us about your initiative, upload supporting documents, and receive 
          a structured recommendation with citations.
        </p>

        {/* CTA Button - Enterprise accent */}
        <button
          onClick={handleNewInitiative}
          disabled={loading}
          className="btn-primary text-base px-8 py-3"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              New Initiative
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        {/* Feature highlights - Clean white cards with subtle borders */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-5 text-left">
          <div className="card p-5 hover:border-stroke-accent transition-colors duration-150">
            <div className="w-10 h-10 bg-accent-wash rounded flex items-center justify-center mb-4">
              <MessageSquare className="w-5 h-5 text-accent" />
            </div>
            <h3 className="font-semibold text-text-primary mb-1.5 text-sm">Conversational Intake</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              Define your initiative through natural conversation, not forms.
            </p>
          </div>
          
          <div className="card p-5 hover:border-stroke-accent transition-colors duration-150">
            <div className="w-10 h-10 bg-accent-wash rounded flex items-center justify-center mb-4">
              <FileText className="w-5 h-5 text-accent" />
            </div>
            <h3 className="font-semibold text-text-primary mb-1.5 text-sm">Evidence-Grounded</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              Upload documents and get recommendations backed by citations.
            </p>
          </div>
          
          <div className="card p-5 hover:border-stroke-accent transition-colors duration-150">
            <div className="w-10 h-10 bg-accent-wash rounded flex items-center justify-center mb-4">
              <Library className="w-5 h-5 text-accent" />
            </div>
            <h3 className="font-semibold text-text-primary mb-1.5 text-sm">Case Study Library</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              Memos draw on a curated corpus of clean cooking case studies.
            </p>
          </div>
        </div>

        {/* Subtle footer accent */}
        <div className="mt-14 flex items-center justify-center gap-3">
          <div className="w-8 h-px bg-divider"></div>
          <span className="text-xs text-text-tertiary uppercase tracking-wider">Powered by AI</span>
          <div className="w-8 h-px bg-divider"></div>
        </div>
      </div>
    </main>
  );
}
