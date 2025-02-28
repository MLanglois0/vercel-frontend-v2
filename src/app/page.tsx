"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import Image from 'next/image';

export default function Home() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [hasProjects, setHasProjects] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session);
      if (session) {
        // Fetch projects to check if user has any
        supabase
          .from('projects')
          .select('id')
          .eq('user_id', session.user.id)
          .limit(1)
          .then(({ data }) => {
            setHasProjects(!!(data && data.length > 0));
          });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session);
      if (session) {
        // Fetch projects to check if user has any
        supabase
          .from('projects')
          .select('id')
          .eq('user_id', session.user.id)
          .limit(1)
          .then(({ data }) => {
            setHasProjects(!!(data && data.length > 0));
          });
      } else {
        setHasProjects(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <main className="max-w-2xl mx-auto text-center">
      <Image 
        src="https://h245f0zpl5ltanyh.public.blob.vercel-storage.com/audibloom_logo-transp-lbu8FBtKMafade7Ru6bkwYrrMSOdBe.png"
        alt="Audibloom Logo"
        width={500}
        height={300}
        className="mx-auto"
        priority
      />
      <p>
        <span className="font-bold text-xl block mb-2">Bringing Books to Life</span>
        Audibloom turns books into captivating short videos with imagery, subtitles, and narration, amplifying author visibility and market reach.
      </p>
      {isLoggedIn && (
        <button
          onClick={() => router.push('/projects')}
          className="mt-6 px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          {hasProjects ? 'Go to My Projects' : 'Get Started'}
        </button>
      )}
    </main>
  );
}
