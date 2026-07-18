export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action_type: string
          administrator_id: string | null
          after_values: Json | null
          before_values: Json | null
          created_at: string
          id: string
          reason: string | null
          target_id: string | null
          target_type: string
        }
        Insert: {
          action_type: string
          administrator_id?: string | null
          after_values?: Json | null
          before_values?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          target_id?: string | null
          target_type: string
        }
        Update: {
          action_type?: string
          administrator_id?: string | null
          after_values?: Json | null
          before_values?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_administrator_id_fkey"
            columns: ["administrator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_enrollments: {
        Row: {
          academic_term: Database["public"]["Enums"]["academic_term"]
          active: boolean
          class_id: string
          created_at: string
          id: string
          student_id: string
          updated_at: string
        }
        Insert: {
          academic_term?: Database["public"]["Enums"]["academic_term"]
          active?: boolean
          class_id: string
          created_at?: string
          id?: string
          student_id: string
          updated_at?: string
        }
        Update: {
          academic_term?: Database["public"]["Enums"]["academic_term"]
          active?: boolean
          class_id?: string
          created_at?: string
          id?: string
          student_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_enrollments_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_enrollments_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      class_meeting_slots: {
        Row: {
          class_id: string
          created_at: string
          day_type: Database["public"]["Enums"]["day_type"]
          id: string
          period_number: number
        }
        Insert: {
          class_id: string
          created_at?: string
          day_type: Database["public"]["Enums"]["day_type"]
          id?: string
          period_number: number
        }
        Update: {
          class_id?: string
          created_at?: string
          day_type?: Database["public"]["Enums"]["day_type"]
          id?: string
          period_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "class_meeting_slots_class_id_fkey"
            columns: ["class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
        ]
      }
      classes: {
        Row: {
          course_name_id: string
          created_at: string
          created_by: string | null
          default_academic_term: Database["public"]["Enums"]["academic_term"]
          id: string
          is_double_period: boolean
          normalized_teacher_last_name: string
          status: Database["public"]["Enums"]["class_status"]
          teacher_last_name: string
          updated_at: string
        }
        Insert: {
          course_name_id: string
          created_at?: string
          created_by?: string | null
          default_academic_term?: Database["public"]["Enums"]["academic_term"]
          id?: string
          is_double_period?: boolean
          normalized_teacher_last_name: string
          status?: Database["public"]["Enums"]["class_status"]
          teacher_last_name: string
          updated_at?: string
        }
        Update: {
          course_name_id?: string
          created_at?: string
          created_by?: string | null
          default_academic_term?: Database["public"]["Enums"]["academic_term"]
          id?: string
          is_double_period?: boolean
          normalized_teacher_last_name?: string
          status?: Database["public"]["Enums"]["class_status"]
          teacher_last_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_course_name_id_fkey"
            columns: ["course_name_id"]
            isOneToOne: false
            referencedRelation: "course_names"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      course_names: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          normalized_name: string
          source: string
          status: Database["public"]["Enums"]["course_name_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          normalized_name: string
          source?: string
          status?: Database["public"]["Enums"]["course_name_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          normalized_name?: string
          source?: string
          status?: Database["public"]["Enums"]["course_name_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_names_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          grade: number | null
          id: string
          normalized_name: string
          onboarding_completed: boolean
          privacy_setting: Database["public"]["Enums"]["privacy_setting"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          grade?: number | null
          id: string
          normalized_name?: string
          onboarding_completed?: boolean
          privacy_setting?: Database["public"]["Enums"]["privacy_setting"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          grade?: number | null
          id?: string
          normalized_name?: string
          onboarding_completed?: boolean
          privacy_setting?: Database["public"]["Enums"]["privacy_setting"]
          updated_at?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          assigned_admin_id: string | null
          created_at: string
          explanation: string | null
          id: string
          reason_category: Database["public"]["Enums"]["report_reason"]
          reported_class_id: string | null
          reported_course_name_snapshot: string | null
          reported_user_id: string | null
          reporter_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
          status: Database["public"]["Enums"]["report_status"]
        }
        Insert: {
          assigned_admin_id?: string | null
          created_at?: string
          explanation?: string | null
          id?: string
          reason_category: Database["public"]["Enums"]["report_reason"]
          reported_class_id?: string | null
          reported_course_name_snapshot?: string | null
          reported_user_id?: string | null
          reporter_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Update: {
          assigned_admin_id?: string | null
          created_at?: string
          explanation?: string | null
          id?: string
          reason_category?: Database["public"]["Enums"]["report_reason"]
          reported_class_id?: string | null
          reported_course_name_snapshot?: string | null
          reported_user_id?: string | null
          reporter_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "reports_assigned_admin_id_fkey"
            columns: ["assigned_admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reported_class_id_fkey"
            columns: ["reported_class_id"]
            isOneToOne: false
            referencedRelation: "classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_change_history: {
        Row: {
          action: Database["public"]["Enums"]["schedule_action"]
          changed_by: string | null
          created_at: string
          id: string
          new_value: Json | null
          previous_value: Json | null
          student_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["schedule_action"]
          changed_by?: string | null
          created_at?: string
          id?: string
          new_value?: Json | null
          previous_value?: Json | null
          student_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["schedule_action"]
          changed_by?: string | null
          created_at?: string
          id?: string
          new_value?: Json | null
          previous_value?: Json | null
          student_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schedule_change_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_change_history_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_share_links: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          owner_id: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          owner_id: string
          token?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          owner_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_share_links_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_archive_class: {
        Args: { p_class_id: string; p_reason: string }
        Returns: undefined
      }
      admin_create_course_name: {
        Args: { p_name: string; p_reason: string }
        Returns: string
      }
      admin_delete_class_section: {
        Args: { p_class_id: string; p_reason: string }
        Returns: undefined
      }
      admin_delete_schedule_import_diagnostic: {
        Args: { p_diagnostic_id: string }
        Returns: undefined
      }
      admin_delete_user: {
        Args: { p_reason: string; p_user_id: string }
        Returns: undefined
      }
      admin_get_homepage_statistic_settings: {
        Args: never
        Returns: {
          activity_scope: string
          minimum_value: number
          shown: boolean
          statistic_key: string
          updated_at: string
        }[]
      }
      admin_list_classes: {
        Args: never
        Returns: {
          active_enrollment_count: number
          class_id: string
          course_name: string
          course_name_id: string
          created_at: string
          created_by: string
          default_academic_term: Database["public"]["Enums"]["academic_term"]
          is_double_period: boolean
          meeting_slots: Json
          report_count: number
          status: Database["public"]["Enums"]["class_status"]
          teacher_last_name: string
          total_enrollment_count: number
          updated_at: string
        }[]
      }
      admin_list_course_names: {
        Args: never
        Returns: {
          active_section_count: number
          course_name: string
          course_name_id: string
          created_at: string
          section_count: number
          source: string
          status: Database["public"]["Enums"]["course_name_status"]
          updated_at: string
        }[]
      }
      admin_list_reports: {
        Args: never
        Returns: {
          assigned_admin_id: string
          assigned_admin_name: string
          created_at: string
          explanation: string
          reason_category: Database["public"]["Enums"]["report_reason"]
          report_id: string
          reported_class_id: string
          reported_course_name: string
          reported_user_id: string
          reported_user_name: string
          reporter_id: string
          reporter_name: string
          resolution_notes: string
          resolved_at: string
          status: Database["public"]["Enums"]["report_status"]
        }[]
      }
      admin_list_schedule_import_diagnostics: {
        Args: never
        Returns: {
          created_at: string
          diagnostic_id: string
          expires_at: string
          image_metadata: Json
          model_id: string
          output_token_limit: number
          parsed_output: Json
          prompt: string
          provider_error: Json
          raw_output: string
          status: string
          thinking_level: string
          timing_ms: number
          validation_errors: Json
        }[]
      }
      admin_list_schedule_import_models: {
        Args: never
        Returns: {
          display_name: string
          enabled: boolean
          is_active: boolean
          max_output_tokens: number
          model_id: string
          production_output_token_limit: number
          production_thinking_level: string
          supported_thinking_levels: string[]
          supports_image_input: boolean
          supports_structured_output: boolean
        }[]
      }
      admin_list_users: {
        Args: { p_grade?: number; p_query?: string; p_status?: string }
        Returns: {
          created_at: string
          full_name: string
          grade: number
          is_admin: boolean
          privacy_setting: Database["public"]["Enums"]["privacy_setting"]
          status: string
          user_id: string
        }[]
      }
      admin_merge_classes: {
        Args: {
          p_canonical_class_id: string
          p_duplicate_class_id: string
          p_reason: string
        }
        Returns: undefined
      }
      admin_merge_course_names: {
        Args: {
          p_canonical_course_name_id: string
          p_duplicate_course_name_id: string
          p_reason: string
        }
        Returns: undefined
      }
      admin_promote_user: {
        Args: { p_reason: string; p_user_id: string }
        Returns: undefined
      }
      admin_remove_user_role: {
        Args: { p_reason: string; p_user_id: string }
        Returns: undefined
      }
      admin_rename_course_name: {
        Args: { p_course_name_id: string; p_name: string; p_reason: string }
        Returns: undefined
      }
      admin_resolve_report: {
        Args: {
          p_report_id: string
          p_resolution_notes: string
          p_status: Database["public"]["Enums"]["report_status"]
        }
        Returns: undefined
      }
      admin_restore_user: {
        Args: { p_reason: string; p_user_id: string }
        Returns: undefined
      }
      admin_set_course_name_enabled: {
        Args: { p_course_name_id: string; p_enabled: boolean; p_reason: string }
        Returns: undefined
      }
      admin_set_enrollment: {
        Args: {
          p_academic_term: Database["public"]["Enums"]["academic_term"]
          p_active: boolean
          p_allow_conflict: boolean
          p_class_id: string
          p_reason: string
          p_student_id: string
        }
        Returns: undefined
      }
      admin_suspend_user: {
        Args: { p_reason: string; p_user_id: string }
        Returns: undefined
      }
      admin_update_class: {
        Args: {
          p_academic_term: Database["public"]["Enums"]["academic_term"]
          p_class_id: string
          p_course_name_id: string
          p_is_double_period: boolean
          p_meeting_slots: Json
          p_reason: string
          p_teacher_last_name: string
        }
        Returns: undefined
      }
      admin_update_homepage_statistic_settings: {
        Args: {
          p_activity_scope: string
          p_minimum_value: number
          p_shown: boolean
          p_statistic_key: string
        }
        Returns: undefined
      }
      admin_update_schedule_import_settings: {
        Args: {
          p_model_id: string
          p_output_token_limit: number
          p_thinking_level: string
        }
        Returns: undefined
      }
      admin_update_user: {
        Args: {
          p_full_name: string
          p_grade: number
          p_privacy_setting: Database["public"]["Enums"]["privacy_setting"]
          p_reason: string
          p_user_id: string
        }
        Returns: undefined
      }
      create_class_and_enroll: {
        Args: {
          p_academic_term: Database["public"]["Enums"]["academic_term"]
          p_confirmed_no_course_match: boolean
          p_course_name_id: string
          p_is_double_period: boolean
          p_meeting_slots: Json
          p_new_course_name: string
          p_teacher_last_name: string
        }
        Returns: string
      }
      create_report: {
        Args: {
          p_explanation?: string
          p_reason_category: Database["public"]["Enums"]["report_reason"]
          p_reported_class_id?: string
          p_reported_user_id?: string
        }
        Returns: string
      }
      enroll_in_class: {
        Args: {
          p_academic_term: Database["public"]["Enums"]["academic_term"]
          p_allow_conflict?: boolean
          p_class_id: string
        }
        Returns: string
      }
      get_class_members: {
        Args: { p_class_id: string }
        Returns: {
          can_view_schedule: boolean
          full_name: string
          grade: number
          privacy_setting: Database["public"]["Enums"]["privacy_setting"]
          student_id: string
        }[]
      }
      get_classmates: {
        Args: never
        Returns: {
          can_view_schedule: boolean
          full_name: string
          grade: number
          privacy_setting: Database["public"]["Enums"]["privacy_setting"]
          shared_course_names: Json
          student_id: string
        }[]
      }
      get_homepage_statistic: {
        Args: never
        Returns: {
          activity_scope: string
          statistic_key: string
          statistic_label: string
          statistic_value: number
        }[]
      }
      get_my_account_state: {
        Args: never
        Returns: {
          deleted: boolean
          suspended: boolean
          suspension_reason: string
        }[]
      }
      get_or_create_schedule_share: { Args: never; Returns: string }
      get_public_schedule_share: { Args: { p_token: string }; Returns: Json }
      get_visible_schedule: {
        Args: { p_student_id: string }
        Returns: {
          academic_term: Database["public"]["Enums"]["academic_term"]
          class_id: string
          course_name: string
          course_name_id: string
          created_at: string
          enrollment_id: string
          is_double_period: boolean
          meeting_slots: Json
          teacher_last_name: string
        }[]
      }
      guest_search_students: {
        Args: { p_first_name: string; p_limit?: number }
        Returns: {
          display_name: string
          first_name: string
          last_initial: string
        }[]
      }
      is_current_user_admin: { Args: never; Returns: boolean }
      record_schedule_import_diagnostic: {
        Args: {
          p_image_metadata: Json
          p_model_id: string
          p_output_token_limit: number
          p_parsed_output: Json
          p_prompt: string
          p_provider_error: Json
          p_raw_output: string
          p_status: string
          p_thinking_level: string
          p_timing_ms: number
          p_validation_errors: Json
        }
        Returns: string
      }
      remove_enrollment: {
        Args: { p_enrollment_id: string }
        Returns: undefined
      }
      replace_enrollment: {
        Args: {
          p_academic_term: Database["public"]["Enums"]["academic_term"]
          p_allow_conflict?: boolean
          p_enrollment_id: string
          p_new_class_id: string
        }
        Returns: string
      }
      replace_schedule_from_import: {
        Args: { p_rows: Json }
        Returns: {
          added_count: number
          removed_count: number
        }[]
      }
      schedule_import_prepare: {
        Args: {
          p_developer_mode?: boolean
          p_model_id?: string
          p_thinking_level?: string
        }
        Returns: {
          bypassed_rate_limit: boolean
          is_admin: boolean
          model_id: string
          output_token_limit: number
          thinking_level: string
          user_id: string
        }[]
      }
      search_classes: {
        Args: {
          p_day_type?: Database["public"]["Enums"]["day_type"]
          p_limit?: number
          p_period_number?: number
          p_query?: string
        }
        Returns: {
          class_id: string
          course_name: string
          course_name_id: string
          default_academic_term: Database["public"]["Enums"]["academic_term"]
          is_double_period: boolean
          meeting_slots: Json
          score: number
          teacher_last_name: string
        }[]
      }
      search_course_names: {
        Args: { p_limit?: number; p_query?: string }
        Returns: {
          course_name: string
          course_name_id: string
          score: number
        }[]
      }
      search_reportable_users: {
        Args: { p_limit?: number; p_query?: string; p_user_id?: string }
        Returns: {
          full_name: string
          grade: number
          student_id: string
        }[]
      }
      search_student_directory: {
        Args: {
          p_course_name?: string
          p_grade?: number
          p_query?: string
          p_teacher_last_name?: string
        }
        Returns: {
          can_view_schedule: boolean
          full_name: string
          grade: number
          privacy_setting: Database["public"]["Enums"]["privacy_setting"]
          shared_class_count: number
          student_id: string
        }[]
      }
      update_enrollment_term: {
        Args: {
          p_academic_term: Database["public"]["Enums"]["academic_term"]
          p_enrollment_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      academic_term: "full_year" | "semester_1" | "semester_2"
      class_status: "active" | "archived" | "merged"
      course_name_status: "active" | "disabled" | "merged"
      day_type: "A" | "B"
      privacy_setting: "private" | "classmates" | "school"
      report_reason:
        | "suspicious_user"
        | "inappropriate_name"
        | "incorrect_class_information"
        | "duplicate_class"
        | "other"
      report_status: "open" | "in_review" | "resolved" | "dismissed"
      schedule_action:
        | "class_added"
        | "class_removed"
        | "class_replaced"
        | "term_changed"
        | "meeting_slots_changed"
        | "admin_schedule_change"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      academic_term: ["full_year", "semester_1", "semester_2"],
      class_status: ["active", "archived", "merged"],
      course_name_status: ["active", "disabled", "merged"],
      day_type: ["A", "B"],
      privacy_setting: ["private", "classmates", "school"],
      report_reason: [
        "suspicious_user",
        "inappropriate_name",
        "incorrect_class_information",
        "duplicate_class",
        "other",
      ],
      report_status: ["open", "in_review", "resolved", "dismissed"],
      schedule_action: [
        "class_added",
        "class_removed",
        "class_replaced",
        "term_changed",
        "meeting_slots_changed",
        "admin_schedule_change",
      ],
    },
  },
} as const
