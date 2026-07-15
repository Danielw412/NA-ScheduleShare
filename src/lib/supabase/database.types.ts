export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Relationship = {
  foreignKeyName: string
  columns: string[]
  isOneToOne: boolean
  referencedRelation: string
  referencedColumns: string[]
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; full_name: string; normalized_name: string; grade: number | null; privacy_setting: Database['public']['Enums']['privacy_setting']; onboarding_completed: boolean; created_at: string; updated_at: string }
        Insert: { id: string; full_name?: string; normalized_name?: string; grade?: number | null; privacy_setting?: Database['public']['Enums']['privacy_setting']; onboarding_completed?: boolean }
        Update: { full_name?: string; grade?: number | null; privacy_setting?: Database['public']['Enums']['privacy_setting']; onboarding_completed?: boolean }
        Relationships: Relationship[]
      }
      classes: {
        Row: { id: string; class_name: string; normalized_class_name: string; teacher_name: string; normalized_teacher_name: string; default_academic_term: Database['public']['Enums']['academic_term']; is_double_period: boolean; status: Database['public']['Enums']['class_status']; created_by: string | null; created_at: string; updated_at: string }
        Insert: never
        Update: never
        Relationships: Relationship[]
      }
      class_meeting_slots: {
        Row: { id: string; class_id: string; day_type: Database['public']['Enums']['day_type']; period_number: number; created_at: string }
        Insert: never
        Update: never
        Relationships: Relationship[]
      }
      class_enrollments: {
        Row: { id: string; student_id: string; class_id: string; academic_term: Database['public']['Enums']['academic_term']; active: boolean; created_at: string; updated_at: string }
        Insert: never
        Update: never
        Relationships: Relationship[]
      }
      schedule_change_history: {
        Row: { id: string; student_id: string | null; action: Database['public']['Enums']['schedule_action']; previous_value: Json | null; new_value: Json | null; changed_by: string | null; created_at: string }
        Insert: never
        Update: never
        Relationships: Relationship[]
      }
      reports: {
        Row: { id: string; reporter_id: string | null; reported_user_id: string | null; reported_class_id: string | null; reason_category: Database['public']['Enums']['report_reason']; explanation: string | null; status: Database['public']['Enums']['report_status']; assigned_admin_id: string | null; resolution_notes: string | null; created_at: string; resolved_at: string | null }
        Insert: never
        Update: never
        Relationships: Relationship[]
      }
      audit_logs: {
        Row: { id: string; administrator_id: string | null; action_type: string; target_type: string; target_id: string | null; before_values: Json | null; after_values: Json | null; reason: string | null; created_at: string }
        Insert: never
        Update: never
        Relationships: Relationship[]
      }
    }
    Views: Record<string, never>
    Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>
    Enums: {
      privacy_setting: 'private' | 'classmates' | 'school'
      academic_term: 'full_year' | 'semester_1' | 'semester_2'
      day_type: 'A' | 'B'
      class_status: 'active' | 'archived' | 'merged'
      schedule_action: 'class_added' | 'class_removed' | 'class_replaced' | 'term_changed' | 'meeting_slots_changed' | 'admin_schedule_change'
      report_reason: 'suspicious_user' | 'inappropriate_name' | 'incorrect_class_information' | 'duplicate_class' | 'other'
      report_status: 'open' | 'in_review' | 'resolved' | 'dismissed'
    }
    CompositeTypes: Record<string, never>
  }
}
