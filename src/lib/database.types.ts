
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "admin_grants": {
                  Row: {
                    "basis": string | null,"grant_kind": string,"granted_at": string,"id": string,"person_id": string,"revoked_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "basis"?: string | null,"grant_kind": string,"granted_at"?: string,"id"?: string,"person_id": string,"revoked_at"?: string | null
                  }
                  Update: {
                    "basis"?: string | null,"grant_kind"?: string,"granted_at"?: string,"id"?: string,"person_id"?: string,"revoked_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "admin_grants_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                },"app_settings": {
                  Row: {
                    "key": string,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"approval_steps": {
                  Row: {
                    "acted_by": string | null,"approver_id": string,"claim_id": string,"client_info": Json | null,"decided_at": string | null,"decision": Database["public"]['Enums']["decision_kind"] | null,"id": string,"reason": string | null,"roles": (string)[],"round": number,"seq": number,"snapshot_hash": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "acted_by"?: string | null,"approver_id": string,"claim_id": string,"client_info"?: Json | null,"decided_at"?: string | null,"decision"?: Database["public"]['Enums']["decision_kind"] | null,"id"?: string,"reason"?: string | null,"roles": (string)[],"round": number,"seq": number,"snapshot_hash"?: string | null
                  }
                  Update: {
                    "acted_by"?: string | null,"approver_id"?: string,"claim_id"?: string,"client_info"?: Json | null,"decided_at"?: string | null,"decision"?: Database["public"]['Enums']["decision_kind"] | null,"id"?: string,"reason"?: string | null,"roles"?: (string)[],"round"?: number,"seq"?: number,"snapshot_hash"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "approval_steps_acted_by_fkey"
      columns: ["acted_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_steps_approver_id_fkey"
      columns: ["approver_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "approval_steps_claim_id_fkey"
      columns: ["claim_id"]
isOneToOne: false
      referencedRelation: "claims"
      referencedColumns: ["id"]
    }
                  ]
                },"attachments": {
                  Row: {
                    "amount_cents": number | null,"bytes": number,"claim_id": string,"created_at": string,"id": string,"merchant": string | null,"mime": string,"receipt_date": string | null,"sha256": string,"storage_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"bytes": number,"claim_id": string,"created_at"?: string,"id"?: string,"merchant"?: string | null,"mime": string,"receipt_date"?: string | null,"sha256": string,"storage_path": string
                  }
                  Update: {
                    "amount_cents"?: number | null,"bytes"?: number,"claim_id"?: string,"created_at"?: string,"id"?: string,"merchant"?: string | null,"mime"?: string,"receipt_date"?: string | null,"sha256"?: string,"storage_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "attachments_claim_id_fkey"
      columns: ["claim_id"]
isOneToOne: false
      referencedRelation: "claims"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_auth": string | null,"actor_id": string | null,"after": Json | null,"at": string,"before": Json | null,"db_role": string,"entity": string,"entity_id": string | null,"id": number,"jwt_role": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_auth"?: string | null,"actor_id"?: string | null,"after"?: Json | null,"at"?: string,"before"?: Json | null,"db_role"?: string,"entity": string,"entity_id"?: string | null,"id"?: never,"jwt_role"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_auth"?: string | null,"actor_id"?: string | null,"after"?: Json | null,"at"?: string,"before"?: Json | null,"db_role"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: never,"jwt_role"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"claim_counters": {
                  Row: {
                    "last_no": number,"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "last_no": number,"year": number
                  }
                  Update: {
                    "last_no"?: number,"year"?: number
                  }
                  Relationships: [
                    
                  ]
                },"claim_duplicates": {
                  Row: {
                    "claim_id": string,"other_claim_id": string,"reason": string
                  }
                  ComputedFields: never
                  Insert: {
                    "claim_id": string,"other_claim_id": string,"reason": string
                  }
                  Update: {
                    "claim_id"?: string,"other_claim_id"?: string,"reason"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "claim_duplicates_claim_id_fkey"
      columns: ["claim_id"]
isOneToOne: false
      referencedRelation: "claims"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "claim_duplicates_other_claim_id_fkey"
      columns: ["other_claim_id"]
isOneToOne: false
      referencedRelation: "claims"
      referencedColumns: ["id"]
    }
                  ]
                },"claim_lines": {
                  Row: {
                    "amount_cents": number,"budget_code": string | null,"claim_id": string,"description": string,"id": string,"sort_order": number
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"budget_code"?: string | null,"claim_id": string,"description": string,"id"?: string,"sort_order"?: number
                  }
                  Update: {
                    "amount_cents"?: number,"budget_code"?: string | null,"claim_id"?: string,"description"?: string,"id"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "claim_lines_claim_id_fkey"
      columns: ["claim_id"]
isOneToOne: false
      referencedRelation: "claims"
      referencedColumns: ["id"]
    }
                  ]
                },"claim_returns": {
                  Row: {
                    "at": string,"claim_id": string,"from_status": Database["public"]['Enums']["claim_status"] | null,"id": string,"reason": string,"returned_by": string,"round": number
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"claim_id": string,"from_status"?: Database["public"]['Enums']["claim_status"] | null,"id"?: string,"reason": string,"returned_by": string,"round": number
                  }
                  Update: {
                    "at"?: string,"claim_id"?: string,"from_status"?: Database["public"]['Enums']["claim_status"] | null,"id"?: string,"reason"?: string,"returned_by"?: string,"round"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "claim_returns_claim_id_fkey"
      columns: ["claim_id"]
isOneToOne: false
      referencedRelation: "claims"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "claim_returns_returned_by_fkey"
      columns: ["returned_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                },"claims": {
                  Row: {
                    "attendees": string | null,"author_id": string,"blocked_at": string | null,"blocked_reason": string | null,"check_delivery": Database["public"]['Enums']["check_delivery"],"claim_no": string | null,"created_at": string,"current_seq": number,"department_id": string,"dup_note": string | null,"dup_warning": boolean,"expense_date": string | null,"first_submitted_at": string | null,"id": string,"late": boolean,"payee_mail_address": string | null,"payee_name": string | null,"purpose": string,"received_at": string | null,"received_by": string | null,"return_reason": string | null,"round": number,"single_approver": boolean,"solo_admin_period": boolean,"status": Database["public"]['Enums']["claim_status"],"submitted_at": string | null,"total_cents": number,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "attendees"?: string | null,"author_id": string,"blocked_at"?: string | null,"blocked_reason"?: string | null,"check_delivery"?: Database["public"]['Enums']["check_delivery"],"claim_no"?: string | null,"created_at"?: string,"current_seq"?: number,"department_id": string,"dup_note"?: string | null,"dup_warning"?: boolean,"expense_date"?: string | null,"first_submitted_at"?: string | null,"id"?: string,"late"?: boolean,"payee_mail_address"?: string | null,"payee_name"?: string | null,"purpose"?: string,"received_at"?: string | null,"received_by"?: string | null,"return_reason"?: string | null,"round"?: number,"single_approver"?: boolean,"solo_admin_period"?: boolean,"status"?: Database["public"]['Enums']["claim_status"],"submitted_at"?: string | null,"total_cents"?: number,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "attendees"?: string | null,"author_id"?: string,"blocked_at"?: string | null,"blocked_reason"?: string | null,"check_delivery"?: Database["public"]['Enums']["check_delivery"],"claim_no"?: string | null,"created_at"?: string,"current_seq"?: number,"department_id"?: string,"dup_note"?: string | null,"dup_warning"?: boolean,"expense_date"?: string | null,"first_submitted_at"?: string | null,"id"?: string,"late"?: boolean,"payee_mail_address"?: string | null,"payee_name"?: string | null,"purpose"?: string,"received_at"?: string | null,"received_by"?: string | null,"return_reason"?: string | null,"round"?: number,"single_approver"?: boolean,"solo_admin_period"?: boolean,"status"?: Database["public"]['Enums']["claim_status"],"submitted_at"?: string | null,"total_cents"?: number,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "claims_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "claims_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "claims_received_by_fkey"
      columns: ["received_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                },"departments": {
                  Row: {
                    "active": boolean,"created_at": string,"id": string,"is_finance": boolean,"name": string,"name_en": string | null,"parent_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"is_finance"?: boolean,"name": string,"name_en"?: string | null,"parent_id"?: string | null
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"is_finance"?: boolean,"name"?: string,"name_en"?: string | null,"parent_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "departments_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    }
                  ]
                },"digest_runs": {
                  Row: {
                    "at": string,"run_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "at"?: string,"run_date": string
                  }
                  Update: {
                    "at"?: string,"run_date"?: string
                  }
                  Relationships: [
                    
                  ]
                },"invites": {
                  Row: {
                    "created_at": string,"created_by": string | null,"expires_at": string,"failed_attempts": number,"id": string,"locked_at": string | null,"person_id": string,"token_hash": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"expires_at": string,"failed_attempts"?: number,"id"?: string,"locked_at"?: string | null,"person_id": string,"token_hash": string,"used_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"expires_at"?: string,"failed_attempts"?: number,"id"?: string,"locked_at"?: string | null,"person_id"?: string,"token_hash"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "invites_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invites_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "attempts": number,"channel": string,"claim_id": string | null,"claimed_at": string | null,"created_at": string,"error": string | null,"id": string,"kind": string,"recipient_id": string,"sent_at": string | null,"status": string,"to_address": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"channel"?: string,"claim_id"?: string | null,"claimed_at"?: string | null,"created_at"?: string,"error"?: string | null,"id"?: string,"kind": string,"recipient_id": string,"sent_at"?: string | null,"status"?: string,"to_address"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"channel"?: string,"claim_id"?: string | null,"claimed_at"?: string | null,"created_at"?: string,"error"?: string | null,"id"?: string,"kind"?: string,"recipient_id"?: string,"sent_at"?: string | null,"status"?: string,"to_address"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_claim_id_fkey"
      columns: ["claim_id"]
isOneToOne: false
      referencedRelation: "claims"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_recipient_id_fkey"
      columns: ["recipient_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_claims": {
                  Row: {
                    "amount_cents": number,"claim_id": string,"payment_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"claim_id": string,"payment_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"claim_id"?: string,"payment_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_claims_claim_id_fkey"
      columns: ["claim_id"]
isOneToOne: false
      referencedRelation: "claims"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_claims_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_events": {
                  Row: {
                    "actor_id": string,"at": string,"cleared_on": string | null,"id": string,"kind": string,"payment_id": string,"reason": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"at"?: string,"cleared_on"?: string | null,"id"?: string,"kind": string,"payment_id": string,"reason"?: string | null
                  }
                  Update: {
                    "actor_id"?: string,"at"?: string,"cleared_on"?: string | null,"id"?: string,"kind"?: string,"payment_id"?: string,"reason"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_events_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount_cents": number,"check_no": string,"cleared_by": string | null,"cleared_on": string | null,"cleared_recorded_at": string | null,"created_at": string,"id": string,"issued_on": string,"memo": string | null,"paid_by": string,"payee_name": string,"replaces_payment_id": string | null,"self_cleared": boolean,"status": Database["public"]['Enums']["payment_status"],"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"check_no": string,"cleared_by"?: string | null,"cleared_on"?: string | null,"cleared_recorded_at"?: string | null,"created_at"?: string,"id"?: string,"issued_on": string,"memo"?: string | null,"paid_by": string,"payee_name": string,"replaces_payment_id"?: string | null,"self_cleared"?: boolean,"status"?: Database["public"]['Enums']["payment_status"],"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"check_no"?: string,"cleared_by"?: string | null,"cleared_on"?: string | null,"cleared_recorded_at"?: string | null,"created_at"?: string,"id"?: string,"issued_on"?: string,"memo"?: string | null,"paid_by"?: string,"payee_name"?: string,"replaces_payment_id"?: string | null,"self_cleared"?: boolean,"status"?: Database["public"]['Enums']["payment_status"],"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_cleared_by_fkey"
      columns: ["cleared_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_paid_by_fkey"
      columns: ["paid_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_replaces_payment_id_fkey"
      columns: ["replaces_payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_voided_by_fkey"
      columns: ["voided_by"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                },"people": {
                  Row: {
                    "church_title": string | null,"created_at": string,"email": string | null,"id": string,"in_person_checked_at": string | null,"lang": string,"legal_name_en": string | null,"mail_address": string | null,"name": string,"needs_in_person_check": boolean,"phone_e164": string | null,"status": Database["public"]['Enums']["person_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "church_title"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"in_person_checked_at"?: string | null,"lang"?: string,"legal_name_en"?: string | null,"mail_address"?: string | null,"name": string,"needs_in_person_check"?: boolean,"phone_e164"?: string | null,"status"?: Database["public"]['Enums']["person_status"]
                  }
                  Update: {
                    "church_title"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"in_person_checked_at"?: string | null,"lang"?: string,"legal_name_en"?: string | null,"mail_address"?: string | null,"name"?: string,"needs_in_person_check"?: boolean,"phone_e164"?: string | null,"status"?: Database["public"]['Enums']["person_status"]
                  }
                  Relationships: [
                    
                  ]
                },"person_logins": {
                  Row: {
                    "auth_user_id": string,"linked_at": string,"linked_via": string,"person_id": string,"provider": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auth_user_id": string,"linked_at"?: string,"linked_via": string,"person_id": string,"provider": string
                  }
                  Update: {
                    "auth_user_id"?: string,"linked_at"?: string,"linked_via"?: string,"person_id"?: string,"provider"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "person_logins_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                },"positions": {
                  Row: {
                    "created_at": string,"department_id": string,"ends_on": string | null,"id": string,"person_id": string,"role": string,"starts_on": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"department_id": string,"ends_on"?: string | null,"id"?: string,"person_id": string,"role": string,"starts_on": string
                  }
                  Update: {
                    "created_at"?: string,"department_id"?: string,"ends_on"?: string | null,"id"?: string,"person_id"?: string,"role"?: string,"starts_on"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "positions_department_id_fkey"
      columns: ["department_id"]
isOneToOne: false
      referencedRelation: "departments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "positions_person_id_fkey"
      columns: ["person_id"]
isOneToOne: false
      referencedRelation: "people"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invite":
{ Args: { "p_last4": string,"p_token": string }; Returns: Json
                           },
"act_on_claim":
{ Args: { "p_claim": string,"p_client": Json,"p_decision": Database["public"]['Enums']["decision_kind"],"p_reason": string,"p_version": number }; Returns: Database["public"]['Enums']["claim_status"]
                           },
"add_attachment":
{ Args: { "p_amount_cents": number,"p_bytes": number,"p_claim": string,"p_merchant": string,"p_mime": string,"p_receipt_date": string,"p_sha256": string,"p_storage_path": string }; Returns: string
                           },
"add_attachment_srv":
{ Args: { "p_actor_auth": string,"p_amount_cents": number,"p_claim": string,"p_merchant": string,"p_receipt_date": string,"p_sha256": string,"p_storage_path": string }; Returns: string
                           },
"admin_assign_position":
{ Args: { "p_department": string,"p_ends_on": string,"p_person": string,"p_role": string,"p_starts_on": string }; Returns: string
                           },
"admin_confirm_in_person":
{ Args: { "p_person": string }; Returns: undefined
                           },
"admin_create_department":
{ Args: { "p_is_finance": boolean,"p_name": string,"p_name_en": string,"p_parent": string }; Returns: string
                           },
"admin_create_invite":
{ Args: { "p_person": string }; Returns: string
                           },
"admin_create_person":
{ Args: { "p_church_title": string,"p_email": string,"p_legal_name_en": string,"p_name": string,"p_needs_in_person_check": boolean,"p_phone_e164": string }; Returns: string
                           },
"admin_emails_srv":
{ Args: Record<PropertyKey, never>; Returns: {
              "email": string
            }[]
                           },
"admin_end_position":
{ Args: { "p_ends_on": string,"p_position": string }; Returns: undefined
                           },
"admin_people":
{ Args: Record<PropertyKey, never>; Returns: {
              "has_email": boolean,"id": string,"in_person_checked_at": string,"logins": number,"name": string,"needs_in_person_check": boolean,"phone_last4": string,"status": Database["public"]['Enums']["person_status"]
            }[]
                           },
"admin_reactivate_person":
{ Args: { "p_person": string }; Returns: undefined
                           },
"admin_reassign_current_step":
{ Args: { "p_claim": string,"p_reason": string,"p_version": number }; Returns: string
                           },
"admin_set_person_status":
{ Args: { "p_person": string,"p_status": Database["public"]['Enums']["person_status"] }; Returns: undefined
                           },
"can_i_handle_finance":
{ Args: { "p_claim": string }; Returns: boolean
                           },
"can_upload_receipt_srv":
{ Args: { "p_actor_auth": string,"p_claim": string }; Returns: boolean
                           },
"cancel_own_claim":
{ Args: { "p_claim": string,"p_reason": string,"p_version": number }; Returns: undefined
                           },
"claim_digest_run_srv":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"claim_print_steps":
{ Args: { "p_claim": string }; Returns: {
              "acted_by_name": string,"approver_name": string,"decided_at": string,"decision": Database["public"]['Enums']["decision_kind"],"roles": (string)[],"seq": number,"snapshot8": string,"step_id": string,"valid": boolean
            }[]
                           },
"create_claim":
{ Args: { "p_department": string }; Returns: string
                           },
"delete_draft":
{ Args: { "p_claim": string,"p_version": number }; Returns: undefined
                           },
"finance_emails_srv":
{ Args: Record<PropertyKey, never>; Returns: {
              "email": string
            }[]
                           },
"finance_export":
{ Args: { "p_month": string }; Returns: {
              "amount_cents": number,"approvers": string,"author": string,"backdated": boolean,"check_amount_cents": number,"check_no": string,"claim_no": string,"cleared_by": string,"cleared_on": string,"department": string,"dup_note": string,"dup_warning": boolean,"expense_date": string,"issued_on": string,"late": boolean,"paid_by": string,"payee_name": string,"payment_status": Database["public"]['Enums']["payment_status"],"purpose": string,"received_by": string,"replaces_check_no": string,"returns_count": number,"self_cleared": boolean,"single_approver": boolean,"solo_admin_period": boolean,"void_reason": string,"voided_on": string
            }[]
                           },
"finance_outstanding":
{ Args: Record<PropertyKey, never>; Returns: {
              "amount_cents": number,"check_no": string,"claim_no": string,"days": number,"payee_name": string,"section": string,"since": string
            }[]
                           },
"finance_payments":
{ Args: { "p_since": string }; Returns: {
              "amount_cents": number,"can_clear": boolean,"can_unclear": boolean,"can_void": boolean,"check_delivery": string,"check_no": string,"claim_nos": string,"cleared_by_name": string,"cleared_on": string,"issued_on": string,"paid_by_name": string,"payee_name": string,"payment_id": string,"replaces_check_no": string,"self_cleared": boolean,"status": Database["public"]['Enums']["payment_status"],"void_reason": string,"voided_by_name": string
            }[]
                           },
"finance_queue":
{ Args: Record<PropertyKey, never>; Returns: {
              "author": string,"author_id": string,"check_delivery": Database["public"]['Enums']["check_delivery"],"claim_id": string,"claim_no": string,"department": string,"dup_warning": boolean,"late": boolean,"single_approver": boolean,"status": Database["public"]['Enums']["claim_status"],"submitted_at": string,"total_cents": number
            }[]
                           },
"invite_preview":
{ Args: { "p_token": string }; Returns: Json
                           },
"mark_check_cleared":
{ Args: { "p_cleared_on": string,"p_payment": string }; Returns: undefined
                           },
"me":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"me_finance":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"my_review_queue":
{ Args: Record<PropertyKey, never>; Returns: {
              "author": string,"claim_id": string,"claim_no": string,"department": string,"purpose": string,"roles": (string)[],"single_approver": boolean,"submitted_at": string,"total_cents": number
            }[]
                           },
"old_checks_srv":
{ Args: { "p_days": number }; Returns: {
              "amount_cents": number,"check_no": string,"days": number,"payee_name": string
            }[]
                           },
"preview_approval_line":
{ Args: { "p_department": string }; Returns: {
              "approver_name": string,"roles": (string)[],"seq": number
            }[]
                           },
"receive_claim":
{ Args: { "p_claim": string,"p_dup_note": string,"p_version": number }; Returns: undefined
                           },
"record_payment":
{ Args: { "p_check_amount_cents": number,"p_check_no": string,"p_claims": (string)[],"p_issued_on": string,"p_memo": string }; Returns: string
                           },
"remove_attachment":
{ Args: { "p_attachment": string }; Returns: Json
                           },
"report_blocked_submit":
{ Args: { "p_claim": string,"p_code": string }; Returns: undefined
                           },
"return_claim":
{ Args: { "p_claim": string,"p_reason": string,"p_version": number }; Returns: undefined
                           },
"save_claim_draft":
{ Args: { "p_attendees": string,"p_check_delivery": Database["public"]['Enums']["check_delivery"],"p_claim": string,"p_department": string,"p_expense_date": string,"p_lines": Json,"p_purpose": string,"p_version": number }; Returns: number
                           },
"start_revision":
{ Args: { "p_claim": string,"p_version": number }; Returns: undefined
                           },
"stuck_claims":
{ Args: Record<PropertyKey, never>; Returns: {
              "claim_id": string,"claim_no": string,"days_waiting": number,"department": string,"problem": string,"status": Database["public"]['Enums']["claim_status"],"version": number,"waiting_on": string
            }[]
                           },
"stuck_digest_srv":
{ Args: Record<PropertyKey, never>; Returns: {
              "claim_no": string,"days_waiting": number,"department": string,"problem": string
            }[]
                           },
"submit_claim":
{ Args: { "p_claim": string,"p_version": number }; Returns: Json
                           },
"unmark_check_cleared":
{ Args: { "p_payment": string,"p_reason": string }; Returns: undefined
                           },
"update_my_profile":
{ Args: { "p_email": string,"p_lang": string,"p_legal_name_en": string,"p_mail_address": string }; Returns: undefined
                           },
"void_payment":
{ Args: { "p_payment": string,"p_reason": string }; Returns: undefined
                           },
"withdraw_claim":
{ Args: { "p_claim": string,"p_version": number }; Returns: undefined
                           }
          }
          Enums: {
            "check_delivery": "pickup"|"mail","claim_status": "draft"|"in_review"|"rejected"|"approved"|"received"|"paid"|"cancelled"|"deleted","decision_kind": "approve"|"reject","payment_status": "issued"|"cleared"|"void","person_status": "invited"|"pending"|"active"|"suspended"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "check_delivery": ["pickup", "mail"],"claim_status": ["draft", "in_review", "rejected", "approved", "received", "paid", "cancelled", "deleted"],"decision_kind": ["approve", "reject"],"payment_status": ["issued", "cleared", "void"],"person_status": ["invited", "pending", "active", "suspended"]
          }
        }
} as const
