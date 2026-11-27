using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stayra.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class TenantAiKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AiModel",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AnthropicApiKeyEnc",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AnthropicKeyHint",
                table: "Tenants",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AiModel",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "AnthropicApiKeyEnc",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "AnthropicKeyHint",
                table: "Tenants");
        }
    }
}
