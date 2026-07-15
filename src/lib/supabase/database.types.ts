export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
          class_name: string
          created_at: string
          created_by: string | null
          default_academic_term: Database["public"]["Enums"]["academic_term"]
          id: string
          is_double_period: boolean
          normalized_class_name: string
          normalized_teacher_name: string
          status: Database["public"]["Enums"]["class_status"]
          teacher_name: string
          updated_at: string
        }
        Insert: {
          class_name: string
          created_at?: string
          created_by?: string | null
          default_academic_term?: Database["public"]["Enums"]["academic_term"]
          id?: string
          is_double_period?: boolean
          normalized_class_name: string
          normalized_teacher_name: string
          status?: Database["public"]["Enums"]["class_status"]
          teacher_name: string
          updated_at?: string
        }
        Update: {
          class_name?: string
          created_at?: string
          created_by?: string | null
          default_academic_term?: Database["public"]["Enums"]["academic_term"]
          id?: string
          is_double_period?: boolean
          normalized_class_name?: string
          normalized_teacher_name?: string
          status?: Database["public"]["Enums"]["class_status"]
          teacher_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "classes_created_by_fkey"
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_archive_class: {
        Args: { p_class_id: string; p_reason: string }
        Returns: undefined
      }
      admin_delete_user: {
        Args: { p_reason: string; p_user_id: string }
        Returns: undefined
      }
      admin_list_classes: {
        Args: never
        Returns: {
          class_id: string
          class_name: string
          created_at: string
          created_by: string
          default_academic_term: Database["public"]["Enums"]["academic_term"]
          enrollment_count: number
          is_double_period: boolean
          meeting_slots: Json
          status: Database["public"]["Enums"]["class_status"]
          teacher_name: string
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
          reported_class_name: string
          reported_user_id: string
          reported_user_name: string
          reporter_id: string
          reporter_name: string
          resolution_notes: string
          resolved_at: string
          status: Database["public"]["Enums"]["report_status"]
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
      admin_promote_user: {
        Args: { p_reason: string; p_user_id: string }
        Returns: undefined
      }
      admin_remove_user_role: {
        Args: { p_reason: string; p_user_id: string }
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
          p_class_name: string
          p_is_double_period: boolean
          p_meeting_slots: Json
          p_reason: string
          p_teacher_name: string
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
          p_class_name: string
          p_confirmed_no_match: boolean
          p_is_double_period: boolean
          p_meeting_slots: Json
          p_teacher_name: string
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
          shared_class_names: Json
          student_id: string
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
      get_visible_schedule: {
        Args: { p_student_id: string }
        Returns: {
          academic_term: Database["public"]["Enums"]["academic_term"]
          class_id: string
          class_name: string
          created_at: string
          enrollment_id: string
          is_double_period: boolean
          meeting_slots: Json
          teacher_name: string
        }[]
      }
      is_current_user_admin: { Args: never; Returns: boolean }
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
      search_classes: {
        Args: {
          p_day_type?: Database["public"]["Enums"]["day_type"]
          p_limit?: number
          p_period_number?: number
          p_query?: string
        }
        Returns: {
          class_id: string
          class_name: string
          default_academic_term: Database["public"]["Enums"]["academic_term"]
          is_double_period: boolean
          meeting_slots: Json
          score: number
          teacher_name: string
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
          p_class_name?: string
          p_grade?: number
          p_query?: string
          p_teacher_name?: string
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      academic_term: ["full_year", "semester_1", "semester_2"],
      class_status: ["active", "archived", "merged"],
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
