import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen p-8 font-[family-name:var(--font-geist-sans)]">
      <nav className="w-full flex justify-between items-center gap-6 mb-20 pb-4 border-b border-black">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-inherit no-underline hover:opacity-80 font-semibold">
            AudiBloom
          </Link>
          <Link href="/projects" className="text-inherit no-underline hover:opacity-80">
            Projects
          </Link>
          <Link href="/pricing" className="text-inherit no-underline hover:opacity-80">
            Pricing
          </Link>
          <Link href="/about" className="text-inherit no-underline hover:opacity-80">
            About
          </Link>
        </div>
        
        <div className="flex items-center gap-6">
          <Link href="/login" className="text-inherit no-underline hover:opacity-80">
            Login
          </Link>
          <Link href="/signup" className="text-inherit no-underline hover:opacity-80">
            Create Account
          </Link>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto text-center">
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor 
          incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis 
          nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. 
          Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore 
          eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt 
          in culpa qui officia deserunt mollit anim id est laborum.
        </p>
      </main>
    </div>
  );
}
