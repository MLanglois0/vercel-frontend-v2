"use client";

import Link from 'next/link';
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import LoginSheet from './LoginSheet'

export default function Nav() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [isLoginOpen, setIsLoginOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    // Check initial auth state
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session)
      setUserId(session?.user?.id || null)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoggedIn(!!session)
      setUserId(session?.user?.id || null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/') // Redirect to home page after logout
  }

  return (
    <>
      <nav className="bg-white shadow-lg">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center h-16">
            {/* Left side links - using flex-start to push to left edge */}
            <div className="flex-1 flex items-center justify-start space-x-8">
              <Link href="/" className="flex items-center">
                <span className="font-bold">Audibloom</span>
              </Link>
              {isLoggedIn && (
                <Link href="/projects">
                  Projects
                </Link>
              )}
              <Link href="/about">
                About
              </Link>
              <Link href="/contact">
                Contact
              </Link>
              <Link href="/services">
                Services
              </Link>
            </div>
            
            {/* Right side auth links - using flex-end to push to right edge */}
            <div className="flex items-center justify-end space-x-4">
              {!isLoggedIn ? (
                <>
                  <button
                    onClick={() => setIsLoginOpen(true)}
                    className="py-2 px-4 hover:text-blue-500"
                  >
                    Login
                  </button>
                  <Link href="/create-account" className="py-2 px-4 hover:text-blue-500">
                    Create Account
                  </Link>
                </>
              ) : (
                <>
                  <span className="text-blue-300">{userId}</span>
                  <Link href="/profile" className="py-2 px-4 hover:text-blue-500">
                    Profile
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="py-2 px-4 hover:text-blue-500"
                  >
                    Logout
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      <LoginSheet 
        isOpen={isLoginOpen} 
        onClose={() => setIsLoginOpen(false)} 
      />
    </>
  )
} 