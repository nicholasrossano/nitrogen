'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FileText, ArrowRight } from 'lucide-react';
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
        {/* Logo/Title */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Nitrogen
          </h1>
          <p className="text-xl text-gray-600">
            Decision Packet Studio
          </p>
        </div>

        {/* Description */}
        <p className="text-gray-600 mb-12 max-w-lg mx-auto">
          Generate investment memos grounded in evidence through conversational AI. 
          Tell us about your initiative, upload supporting documents, and receive 
          a structured recommendation with citations.
        </p>

        {/* CTA Button */}
        <button
          onClick={handleNewInitiative}
          disabled={loading}
          className="inline-flex items-center gap-3 px-8 py-4 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 transition-colors shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
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

        {/* Feature highlights */}
        <div className="mt-16 grid grid-cols-3 gap-8 text-left">
          <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
              <span className="text-xl">💬</span>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Conversational Intake</h3>
            <p className="text-sm text-gray-600">
              Define your initiative through natural conversation, not forms.
            </p>
          </div>
          <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
              <span className="text-xl">📄</span>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Evidence-Grounded</h3>
            <p className="text-sm text-gray-600">
              Upload documents and get recommendations backed by citations.
            </p>
          </div>
          <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center mb-4">
              <span className="text-xl">📊</span>
            </div>
            <h3 className="font-semibold text-gray-900 mb-2">Case Study Library</h3>
            <p className="text-sm text-gray-600">
              Memos draw on a curated corpus of clean cooking case studies.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
