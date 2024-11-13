import { NextResponse } from "next/server";
import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/server/supabase-admin';

// Add interface for project data
interface ProjectCreate {
  project_name: string;
  book_title: string;
  description?: string;
  status?: string;
  epub_file_path?: string | null;
}

export async function GET() {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('Session error:', sessionError);
      return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
    }
    
    if (!session) {
      console.log('No session found');
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from('projects')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase query error:', error);
      throw error;
    }
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Detailed error:', error);
    return NextResponse.json(
      { error: "Failed to fetch projects", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    // Get the user session using client supabase instance
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('Session error:', sessionError);
      return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
    }

    if (!session) {
      console.log('No session found');
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json() as ProjectCreate;
    
    // Validate required fields
    if (!body.project_name || !body.book_title) {
      return NextResponse.json(
        { error: "Missing required fields: project_name and book_title are required" },
        { status: 400 }
      );
    }

    // Use supabaseAdmin for database operations
    const { data, error } = await supabaseAdmin
      .from('projects')
      .insert([
        {
          user_id: session.user.id,
          project_name: body.project_name,
          book_title: body.book_title,
          description: body.description || null,
          status: body.status || 'NEW',
          epub_file_path: body.epub_file_path || null,
        }
      ])
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Detailed error:', error);
    return NextResponse.json(
      { error: "Failed to create project", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
} 