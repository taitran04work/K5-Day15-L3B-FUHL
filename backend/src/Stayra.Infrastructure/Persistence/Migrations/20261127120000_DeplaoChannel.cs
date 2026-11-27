using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stayra.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class DeplaoChannel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "DeplaoAccountId",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeplaoApiKeyEnc",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeplaoBaseUrl",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeplaoWebhookId",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DeplaoWebhookSecretEnc",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExternalAccountId",
                table: "Conversations",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExternalMessageId",
                table: "Messages",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Messages_ConversationId_ExternalMessageId",
                table: "Messages",
                columns: new[] { "ConversationId", "ExternalMessageId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Messages_ConversationId_ExternalMessageId",
                table: "Messages");

            migrationBuilder.DropColumn(
                name: "DeplaoAccountId",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "DeplaoApiKeyEnc",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "DeplaoBaseUrl",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "DeplaoWebhookId",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "DeplaoWebhookSecretEnc",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "ExternalAccountId",
                table: "Conversations");

            migrationBuilder.DropColumn(
                name: "ExternalMessageId",
                table: "Messages");
        }
    }
}
