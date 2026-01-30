'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ArrowRight } from 'lucide-react';
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
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl mx-auto text-center">
        {/* Logo/Title - Editorial style with Didot-like font */}
        <div className="mb-10">
          <h1 className="text-5xl font-display italic text-brown mb-3 tracking-tight">
            Nitrogen
          </h1>
          <p className="text-lg text-brown/70 font-medium tracking-wide">
            Decision Packet Studio
          </p>
        </div>

        {/* Description */}
        <p className="text-brown/80 mb-12 max-w-lg mx-auto leading-relaxed">
          Generate investment memos grounded in evidence through conversational AI. 
          Tell us about your initiative, upload supporting documents, and receive 
          a structured recommendation with citations.
        </p>

        {/* CTA Button - Burgundy pill with soft shadow */}
        <button
          onClick={handleNewInitiative}
          disabled={loading}
          className="btn-primary text-lg px-10 py-4"
        >
          {loading ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Creating...
            </>
          ) : (
            <>
              <Plus className="w-5 h-5" />
              New Initiative
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>

        {/* Feature highlights - Warm cards with soft shadows */}
        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <div className="card-elevated p-6 hover:shadow-heavy transition-shadow duration-300">
            <div className="w-12 h-12 bg-blush rounded-card flex items-center justify-center mb-4">
              <span className="text-2xl">💬</span>
            </div>
            <h3 className="font-semibold text-brown mb-2">Conversational Intake</h3>
            <p className="text-sm text-brown/70 leading-relaxed">
              Define your initiative through natural conversation, not forms.
            </p>
          </div>
          
          <div className="card-elevated p-6 hover:shadow-heavy transition-shadow duration-300">
            <div className="w-12 h-12 bg-blush rounded-card flex items-center justify-center mb-4">
              <span className="text-2xl">📄</span>
            </div>
            <h3 className="font-semibold text-brown mb-2">Evidence-Grounded</h3>
            <p className="text-sm text-brown/70 leading-relaxed">
              Upload documents and get recommendations backed by citations.
            </p>
          </div>
          
          <div className="card-elevated p-6 hover:shadow-heavy transition-shadow duration-300">
            <div className="w-12 h-12 bg-blush rounded-card flex items-center justify-center mb-4">
              <span className="text-2xl">📚</span>
            </div>
            <h3 className="font-semibold text-brown mb-2">Case Study Library</h3>
            <p className="text-sm text-brown/70 leading-relaxed">
              Memos draw on a curated corpus of clean cooking case studies.
            </p>
          </div>
        </div>

        {/* Subtle footer accent */}
        <div className="mt-16 flex items-center justify-center gap-2">
          <div className="w-8 h-px bg-beige"></div>
          <span className="text-xs text-brown/40 uppercase tracking-widest">Powered by AI</span>
          <div className="w-8 h-px bg-beige"></div>
        </div>
      </div>
    </main>
  );
}
