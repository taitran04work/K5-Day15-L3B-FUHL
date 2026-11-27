using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Stayra.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class RenameMomoToVnpay : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MomoAccessKeyEnc",
                table: "Tenants");

            migrationBuilder.RenameColumn(
                name: "MomoPartnerCode",
                table: "Tenants",
                newName: "VnpayTmnCode");

            migrationBuilder.RenameColumn(
                name: "MomoSecretKeyEnc",
                table: "Tenants",
                newName: "VnpayHashSecretEnc");

            migrationBuilder.Sql("""
                UPDATE "Tenants" SET "VnpayTmnCode" = NULL, "VnpayHashSecretEnc" = NULL;
                UPDATE "Payments" SET "Provider" = 'VNPay' WHERE "Provider" = 'MoMo';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "Payments" SET "Provider" = 'MoMo' WHERE "Provider" = 'VNPay';
                """);

            migrationBuilder.RenameColumn(
                name: "VnpayTmnCode",
                table: "Tenants",
                newName: "MomoPartnerCode");

            migrationBuilder.RenameColumn(
                name: "VnpayHashSecretEnc",
                table: "Tenants",
                newName: "MomoSecretKeyEnc");

            migrationBuilder.AddColumn<string>(
                name: "MomoAccessKeyEnc",
                table: "Tenants",
                type: "text",
                nullable: true);
        }
    }
}
