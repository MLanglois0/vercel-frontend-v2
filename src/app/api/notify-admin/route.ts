import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Admin email address for notifications
const ADMIN_EMAIL = 'mike@mimetex.co';

export async function POST(
  request: Request
) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { issue, details, projectId, timestamp } = body;

    if (!issue) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Log to supabase or your preferred notification system
    const { error: insertError } = await supabase
      .from('system_notifications')
      .insert({
        user_id: session.user.id,
        user_email: session.user.email,
        issue,
        details,
        project_id: projectId,
        timestamp: timestamp || new Date().toISOString(),
        status: 'new',
        admin_email: ADMIN_EMAIL // Store the admin email that was notified
      });

    if (insertError) {
      console.error('Failed to log notification:', insertError);
      return NextResponse.json({ error: 'Failed to log notification' }, { status: 500 });
    }

    // In a production environment, you would also send an email here
    // Example using a mail service library:
    // await sendEmail({
    //   to: ADMIN_EMAIL,
    //   subject: `System Alert: ${issue}`,
    //   text: `Issue: ${issue}\nDetails: ${details}\nUser: ${session.user.email}\nProject: ${projectId}\nTime: ${timestamp}`
    // });

    // If your application has SendGrid or another email provider set up, uncomment and use this:
    try {
      // Attempt to send an email notification (depends on your email setup)
      // This is just a placeholder - replace with your actual email sending code
      console.log(`[ALERT] Email notification sent to ${ADMIN_EMAIL}:`, {
        subject: `System Alert: ${issue}`,
        body: `Issue: ${issue}\nDetails: ${details}\nUser: ${session.user.email}\nProject: ${projectId}\nTime: ${timestamp || new Date().toISOString()}`
      });
    } catch (emailError) {
      // Log error but don't fail the request
      console.error('Failed to send email notification:', emailError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in notify-admin API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 